mod geometry;
mod loading;
mod menu;
mod menu_model;
mod microphone;
mod microphone_menu;
mod presentation;
mod scaling;
mod screens;
mod settings;
mod status_bar;
mod window_controls;
use anyhow::{bail, ensure, Context, Result};
use geometry::{fit_base, switch_layout};
use loading::{Loaded, Loader, Recent};
use menu_model::AvatarMenu;
use mesh_avatar_core::{
    engine::{expression::OVERLAY_EXPRESSIONS, motion::SpeakOptions},
    format::AvatarPackage,
    Avatar, Frame,
};
use mesh_avatar_wgpu::{Fit, Renderer, ViewOptions};
use presentation::StraightAlpha;
use scaling::{render_size, ScaleBounds, Scaling};
use settings::{Placement, Settings};
use std::{
    env,
    panic::{catch_unwind, AssertUnwindSafe},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
use window_controls::WindowControls;
use winit::{
    application::ApplicationHandler,
    dpi::{LogicalPosition, PhysicalPosition, PhysicalSize, Position},
    event::{ElementState, MouseButton, WindowEvent},
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    keyboard::{KeyCode, ModifiersState, PhysicalKey},
    window::{Window, WindowId, WindowLevel},
};

fn default_sample() -> Result<PathBuf> {
    let current = env::current_dir()?;
    let executable = env::current_exe()?;
    for start in [
        current.as_path(),
        executable.parent().unwrap_or(Path::new(".")),
    ] {
        for root in start.ancestors() {
            let sample = root.join("samples/miko-qipao");
            if root.join("native/Cargo.toml").is_file() && sample.join("rig.json").is_file() {
                return Ok(sample);
            }
        }
    }
    bail!("Default sample not found. Run from a source checkout or pass a .mavatar file or built project folder.")
}
fn avatar_view(avatar: &Avatar) -> ViewOptions {
    let rig = &avatar.package().rig;
    ViewOptions {
        image_size: [rig.image.width, rig.image.height],
        pad_top: rig.view.pad_top,
        pad_side: rig.view.pad_side,
        fit: Fit::Contain,
    }
}
fn print_motions(avatar: &Avatar) {
    eprintln!("Avatar: {}", avatar.package().manifest.name);
    for (i, motion) in avatar.motions().iter().take(9).enumerate() {
        eprintln!("{}: {}", i + 1, motion.label);
    }
}

/// Keep a painted source-image cutoff outside the window, including extreme poses.
struct TopEdgeGuard {
    vertices: Vec<usize>,
}
impl TopEdgeGuard {
    fn new(avatar: &Avatar, frame: &Frame) -> Self {
        let Some(base) = frame.layers.iter().find(|l| l.name == "base") else {
            return Self { vertices: vec![] };
        };
        let Some(image) = avatar.textures().get("base.png") else {
            return Self { vertices: vec![] };
        };
        let radius = avatar.package().rig.mesh.base_cell as usize + 2;
        let vertices = base
            .uvs
            .as_chunks::<2>()
            .0
            .iter()
            .enumerate()
            .filter_map(|(i, &[u, v])| {
                if v != 0.0 {
                    return None;
                }
                let x = (u * image.width as f32) as usize;
                let from = x.saturating_sub(radius);
                let to = (x + radius + 1).min(image.width as usize);
                (from..to).any(|x| image.rgba[x * 4 + 3] > 3).then_some(i)
            })
            .collect();
        Self { vertices }
    }
    fn view(&self, frame: &Frame, view: ViewOptions, size: [u32; 2]) -> ViewOptions {
        let Some(base) = frame.layers.iter().find(|l| l.name == "base") else {
            return view;
        };
        let max_y = self
            .vertices
            .iter()
            .filter_map(|&i| base.positions.get(i * 2 + 1))
            .copied()
            .map(f64::from)
            .reduce(f64::max);
        let Some(y) = max_y else {
            return view;
        };
        guarded_view(view, size, y)
    }
}
fn guarded_view(view: ViewOptions, size: [u32; 2], y: f64) -> ViewOptions {
    let Ok(transform) = view.transform(size) else {
        return view;
    };
    let current_scale = f64::from(transform[0]) * f64::from(size[0]) / 2.0;
    let height = f64::from(view.image_size[1]);
    let width = f64::from(view.image_size[0]);
    let remaining = height - y - 2.0 / current_scale;
    if remaining <= 0.0 {
        return view;
    }
    let scale = (f64::from(size[1]) / remaining).max(current_scale);
    ViewOptions {
        pad_top: f64::from(size[1]) / (height * scale) - 1.0,
        pad_side: f64::from(size[0]) / (width * scale) / 2.0 - 0.5,
        ..view
    }
}

struct Scene {
    surface: wgpu::Surface<'static>,
    window: Arc<Window>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    view_format: wgpu::TextureFormat,
    renderer: Renderer,
    straight: Option<StraightAlpha>,
    avatar: Avatar,
    view: ViewOptions,
    top_edge: TopEdgeGuard,
    last_frame: Instant,
    scaling: Scaling,
    pending_position: Option<Position>,
    pending_surface_size: Option<PhysicalSize<u32>>,
    redraw_requested: bool,
    gpu_failed: Arc<AtomicBool>,
    modifiers: ModifiersState,
    expression_index: usize,
    controls: WindowControls,
    occluded: bool,
}
impl Scene {
    async fn new(event_loop: &ActiveEventLoop, mut avatar: Avatar) -> Result<Self> {
        let view = avatar_view(&avatar);
        let screen = event_loop
            .primary_monitor()
            .map(|m| m.size().to_logical(m.scale_factor()));
        let base_size = fit_base(&view, screen)?;
        let attributes = Window::default_attributes()
            .with_title("Mesh Avatar")
            .with_inner_size(base_size)
            .with_transparent(true)
            .with_decorations(false)
            .with_resizable(false)
            .with_window_level(WindowLevel::AlwaysOnTop)
            .with_visible(false);
        #[cfg(target_os = "macos")]
        let attributes = {
            use winit::platform::macos::WindowAttributesExtMacOS;
            attributes.with_has_shadow(false)
        };
        let window = Arc::new(event_loop.create_window(attributes)?);
        let instance = wgpu::Instance::new(&Default::default());
        let surface = instance.create_surface(window.clone())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::LowPower,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await?;
        let info = adapter.get_info();
        let caps = surface.get_capabilities(&adapter);
        let alpha_mode = [
            wgpu::CompositeAlphaMode::PreMultiplied,
            wgpu::CompositeAlphaMode::PostMultiplied,
        ]
        .into_iter()
        .find(|mode| caps.alpha_modes.contains(mode))
        .context("The graphics compositor does not support transparent windows")?;
        let format = caps
            .formats
            .iter()
            .copied()
            .find(|f| !f.is_srgb())
            .or_else(|| caps.formats.first().copied())
            .context("No supported surface format")?;
        let view_format = format.remove_srgb_suffix();
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("desktop avatar"),
                ..Default::default()
            })
            .await?;
        let gpu_failed = Arc::new(AtomicBool::new(false));
        let failed = gpu_failed.clone();
        device.on_uncaptured_error(Arc::new(move |error| {
            eprintln!("Desktop graphics error: {error}");
            failed.store(true, Ordering::Relaxed);
        }));
        let size = window.inner_size();
        ensure!(
            render_size(size, size, device.limits().max_texture_dimension_2d).is_some(),
            "initial window exceeds graphics device limits"
        );
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: wgpu::PresentMode::Fifo,
            desired_maximum_frame_latency: 2,
            alpha_mode,
            view_formats: if format == view_format {
                vec![]
            } else {
                vec![view_format]
            },
        };
        surface.configure(&device, &config);
        // wgpu 27's Metal backend labels transparent CAMetalLayer surfaces PostMultiplied,
        // but CoreAnimation consumes the premultiplied pixels produced by our renderer.
        let mut straight = (alpha_mode == wgpu::CompositeAlphaMode::PostMultiplied
            && info.backend != wgpu::Backend::Metal)
            .then(|| StraightAlpha::new(&device, view_format));
        if let Some(pass) = &mut straight {
            pass.resize(&device, view_format, [config.width, config.height]);
        }
        let renderer = Renderer::new(&device, &queue, view_format, 4, avatar.textures())?;
        avatar.set_auto_idle(true);
        avatar.set_auto_motion(true);
        let initial = avatar.tick(0.0);
        let top_edge = TopEdgeGuard::new(&avatar, &initial);
        if let Some(monitor) = window
            .current_monitor()
            .or_else(|| event_loop.primary_monitor())
        {
            let origin = monitor.position();
            let screen = monitor.size();
            let scale = window.scale_factor();
            window.set_outer_position(PhysicalPosition::new(
                origin.x + screen.width as i32 - size.width as i32 - (32.0 * scale) as i32,
                origin.y + screen.height as i32 - size.height as i32 - (64.0 * scale) as i32,
            ));
        }
        eprintln!(
            "Mesh Avatar: {} — {} ({:?}), {:?} transparency, {:.0}×{:.0} logical pixels at {:.1}×",
            avatar.package().manifest.name,
            info.name,
            info.backend,
            alpha_mode,
            base_size.width,
            base_size.height,
            window.scale_factor()
        );
        eprintln!("Drag to move · scroll or Cmd +/- to scale · E expression · K kana · C click-through · Esc quit");
        print_motions(&avatar);
        Ok(Self {
            surface,
            window,
            device,
            queue,
            config,
            view_format,
            renderer,
            straight,
            avatar,
            view,
            top_edge,
            last_frame: Instant::now(),
            scaling: Scaling::new(base_size)?,
            pending_position: None,
            pending_surface_size: None,
            redraw_requested: true,
            gpu_failed,
            modifiers: ModifiersState::empty(),
            expression_index: 0,
            controls: WindowControls::default(),
            occluded: false,
        })
    }
    fn resize(&mut self, size: PhysicalSize<u32>) -> Result<()> {
        if size.width == 0 || size.height == 0 {
            return Ok(());
        }
        ensure!(
            render_size(size, size, self.device.limits().max_texture_dimension_2d).is_some(),
            "window dimensions exceed graphics device limits: {}×{}",
            size.width,
            size.height
        );
        self.config.width = size.width;
        self.config.height = size.height;
        self.surface.configure(&self.device, &self.config);
        if let Some(pass) = &mut self.straight {
            pass.resize(&self.device, self.view_format, [size.width, size.height]);
        }
        self.window.request_redraw();
        Ok(())
    }
    fn scale_bounds(&self) -> ScaleBounds {
        ScaleBounds {
            dpi: self.window.scale_factor(),
            screen: self
                .window
                .current_monitor()
                .map(|m| m.size().to_logical(m.scale_factor())),
            texture_limit: self.device.limits().max_texture_dimension_2d,
        }
    }
    /// Build all replacement state first so a bad avatar cannot remove the live one.
    fn replace_avatar(&mut self, package: AvatarPackage) -> Result<()> {
        let mut avatar = Avatar::from_package(package)?;
        let view = avatar_view(&avatar);
        let layout = switch_layout(
            &view,
            &self.scaling,
            self.scale_bounds(),
            self.window.outer_position()?,
        )?;
        avatar.set_auto_idle(true);
        avatar.set_auto_motion(true);
        let initial = avatar.tick(0.0);
        let top_edge = TopEdgeGuard::new(&avatar, &initial);
        self.device.push_error_scope(wgpu::ErrorFilter::Validation);
        self.device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
        let renderer = catch_unwind(AssertUnwindSafe(|| {
            Renderer::new(
                &self.device,
                &self.queue,
                self.view_format,
                4,
                avatar.textures(),
            )
        }))
        .unwrap_or_else(|_| {
            Err(anyhow::anyhow!(
                "graphics backend could not prepare the new avatar"
            ))
        });
        let memory_error = pollster::block_on(self.device.pop_error_scope());
        let validation_error = pollster::block_on(self.device.pop_error_scope());
        if let Some(error) = memory_error.or(validation_error) {
            bail!("could not upload avatar: {error}");
        }
        let renderer = renderer?;
        self.avatar = avatar;
        self.renderer = renderer;
        self.view = view;
        self.top_edge = top_edge;
        self.scaling = layout.scaling;
        self.pending_position = Some(layout.position.into());
        self.expression_index = 0;
        self.last_frame = Instant::now();
        self.redraw_requested = true;
        print_motions(&self.avatar);
        Ok(())
    }
    fn apply_window_changes(&mut self) {
        if let Some(desired) = self.scaling.take_request() {
            if desired != self.window.inner_size() || self.pending_position.is_some() {
                // macOS returns None and queues Resized. Synchronous platforms may return
                // the accepted size without sending a notification; treat it identically.
                // Logical sizes remain correct when a restore also crosses pixel ratios.
                if let Some(accepted) = self.window.request_inner_size(self.scaling.logical_size())
                {
                    self.pending_surface_size = Some(accepted);
                }
            }
        }
        if let Some(position) = self.pending_position.take() {
            self.window.set_outer_position(position);
        }
    }
    /// Run native resize and GPU work after input/drawRect callbacks return.
    fn service(&mut self) -> Result<()> {
        ensure!(
            !self.gpu_failed.load(Ordering::Relaxed),
            "graphics device reported an error"
        );
        self.apply_window_changes();
        if let Some(size) = self.pending_surface_size.take() {
            // Several notifications can be queued during a trackpad input burst.
            if size == self.window.inner_size() {
                self.resize(size)?;
            }
        }
        self.refresh_visibility();
        if std::mem::take(&mut self.redraw_requested) && self.controls.visible && !self.occluded {
            self.redraw()?;
        }
        ensure!(
            !self.gpu_failed.load(Ordering::Relaxed),
            "graphics device reported an error"
        );
        if self.controls.visible && !self.occluded {
            self.window.request_redraw();
        }
        Ok(())
    }
    fn redraw(&mut self) -> Result<()> {
        let now = Instant::now();
        let dt = (now - self.last_frame).as_secs_f64().min(0.05);
        self.last_frame = now;
        let Some(size) = render_size(
            PhysicalSize::new(self.config.width, self.config.height),
            self.window.inner_size(),
            self.device.limits().max_texture_dimension_2d,
        ) else {
            return Ok(());
        };
        let surface_frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                // Reconfigure on the next service pass with no acquired texture alive.
                eprintln!("Desktop surface changed; reconfiguring before the next frame");
                self.pending_surface_size = Some(self.window.inner_size());
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        if surface_frame.texture.width() != size[0] || surface_frame.texture.height() != size[1] {
            self.pending_surface_size = Some(self.window.inner_size());
            return Ok(());
        }
        let frame = self.avatar.tick(dt);
        let view = self.top_edge.view(&frame, self.view, size);
        let target = surface_frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor {
                format: Some(self.view_format),
                ..Default::default()
            });
        let mut encoder = self.device.create_command_encoder(&Default::default());
        let output = match &self.straight {
            Some(pass) => pass
                .view()
                .context("surface alpha target is not configured")?,
            None => &target,
        };
        self.renderer
            .render(&mut encoder, output, size, &frame, &view)?;
        if let Some(pass) = &self.straight {
            pass.encode(&mut encoder, &target)?;
        }
        self.queue.submit([encoder.finish()]);
        self.window.pre_present_notify();
        surface_frame.present();
        Ok(())
    }
    fn key(&mut self, event_loop: &ActiveEventLoop, key: KeyCode, repeat: bool) {
        let command = if cfg!(target_os = "macos") {
            self.modifiers.super_key()
        } else {
            self.modifiers.control_key()
        };
        match key {
            KeyCode::Escape => event_loop.exit(),
            KeyCode::KeyQ if command => event_loop.exit(),
            KeyCode::Equal | KeyCode::NumpadAdd if command => {
                self.scaling.keyboard(true, self.scale_bounds())
            }
            KeyCode::Minus | KeyCode::NumpadSubtract if command => {
                self.scaling.keyboard(false, self.scale_bounds())
            }
            _ if repeat => {}
            KeyCode::KeyE => {
                let next = (self.expression_index + 1) % OVERLAY_EXPRESSIONS.len();
                self.select_expression(OVERLAY_EXPRESSIONS[next].0);
            }
            KeyCode::KeyK => self.avatar.speak_kana(
                "こんにちは。きょうも、いっしょにあいうえおをれんしゅうしましょう。",
                SpeakOptions::default(),
            ),
            KeyCode::KeyC => self.toggle_click_through(),
            KeyCode::Digit1
            | KeyCode::Digit2
            | KeyCode::Digit3
            | KeyCode::Digit4
            | KeyCode::Digit5
            | KeyCode::Digit6
            | KeyCode::Digit7
            | KeyCode::Digit8
            | KeyCode::Digit9 => {
                let index = match key {
                    KeyCode::Digit1 => 0,
                    KeyCode::Digit2 => 1,
                    KeyCode::Digit3 => 2,
                    KeyCode::Digit4 => 3,
                    KeyCode::Digit5 => 4,
                    KeyCode::Digit6 => 5,
                    KeyCode::Digit7 => 6,
                    KeyCode::Digit8 => 7,
                    _ => 8,
                };
                if let Some(motion) = self.avatar.motions().get(index) {
                    self.avatar.play(&motion.id);
                }
            }
            _ => {}
        }
    }
    fn select_expression(&mut self, name: &str) {
        if let Some(index) = OVERLAY_EXPRESSIONS.iter().position(|(n, _)| *n == name) {
            self.expression_index = index;
            self.avatar.set_expression(name);
            eprintln!("Expression: {name}");
        }
    }
    fn toggle_click_through(&mut self) {
        let window = &self.window;
        match self.controls.set_click_through(!self.controls.click_through, |enabled|window.set_cursor_hittest(!enabled)) {
            Ok(()) => eprintln!("Click-through {}. Use the Mesh Avatar status-bar icon to turn it off, or focus the app and press C.", if self.controls.click_through {"on"} else {"off"}),
            Err(error) => eprintln!("Could not change click-through: {error}"),
        }
    }
    fn refresh_visibility(&mut self) {
        if let Some(visible) = self.window.is_visible() {
            self.controls.visible = visible;
        }
    }
    fn set_visible(&mut self, visible: bool) {
        if visible {
            self.window.set_minimized(false);
        }
        self.window.set_visible(visible);
        self.controls.visible = visible;
        if visible {
            self.occluded = false;
            self.last_frame = Instant::now();
            self.redraw_requested = true;
            self.window.focus_window();
            self.window.request_redraw();
        }
    }
    fn placement(&self, include_pending: bool) -> Option<Placement> {
        if !include_pending
            && (self.scaling.has_request()
                || self.pending_position.is_some()
                || self.pending_surface_size.is_some()
                || self.window.inner_size()
                    != PhysicalSize::new(self.config.width, self.config.height))
        {
            return None;
        }
        let position = match self.pending_position {
            Some(position) => position.to_logical::<f64>(self.window.scale_factor()),
            None => self
                .window
                .outer_position()
                .ok()?
                .to_logical::<f64>(self.window.scale_factor()),
        };
        Some(Placement {
            position: [position.x, position.y],
            zoom: self.scaling.zoom(),
        })
    }
}

enum UserEvent {
    Menu(String),
    Picked(Option<PathBuf>),
    AlertClosed,
    Loaded(Box<Loaded>),
    Microphone(microphone::Event),
}
struct App {
    avatar: Option<Avatar>,
    scene: Option<Scene>,
    error: Option<anyhow::Error>,
    current_path: PathBuf,
    recent: Recent,
    loader: Loader,
    pending_load: Option<Loaded>,
    proxy: EventLoopProxy<UserEvent>,
    menu: Option<menu::AppMenu>,
    commands: Vec<menu::Command>,
    dialog_open: bool,
    settings: Settings,
    microphone: microphone::Microphone,
    mic_driving: bool,
}
impl App {
    fn observe_settings(&mut self, now: Instant, include_pending: bool) {
        if let Some(placement) = self
            .scene
            .as_ref()
            .and_then(|scene| scene.placement(include_pending))
        {
            self.settings.record(&self.current_path, placement, now);
        }
    }
    fn restore_settings(&mut self, event_loop: &ActiveEventLoop) {
        if let Some(scene) = &mut self.scene {
            let placement = self
                .settings
                .placement(&self.current_path)
                .or_else(|| scene.placement(false));
            if let Some(restored) = placement.and_then(|placement| {
                settings::restore(
                    &scene.view,
                    placement,
                    &screens::visible_areas(event_loop),
                    scene.device.limits().max_texture_dimension_2d,
                )
            }) {
                scene.scaling = restored.scaling;
                scene.pending_position =
                    Some(LogicalPosition::new(restored.position[0], restored.position[1]).into());
            }
        }
    }
    fn refresh_avatar_menu(&mut self) {
        if let (Some(menu), Some(scene)) = (&mut self.menu, &self.scene) {
            if let Err(error) = menu.set_avatar(AvatarMenu::new(scene.avatar.motions())) {
                eprintln!("Could not update avatar menu: {error:#}");
            }
        }
    }
    fn refresh_recent(&mut self) {
        if self.recent.prune() {
            if let Err(error) = self.recent.save() {
                eprintln!("Could not save recent avatars: {error:#}");
            }
        }
        if let Some(menu) = &mut self.menu {
            if let Err(error) = menu.set_recent(self.recent.entries()) {
                eprintln!("Could not update recent menu: {error:#}");
            }
        }
    }
    fn request_load(&mut self, path: PathBuf) {
        if let Err(error) = self.loader.request(path) {
            self.load_error(&format!("{error:#}"));
        }
    }
    fn load_error(&mut self, message: &str) {
        eprintln!("Could not open avatar; keeping current avatar: {message}");
        if !self.dialog_open {
            if let Some(scene) = &self.scene {
                match menu::alert(self.proxy.clone(), &scene.window, message) {
                    Ok(()) => self.dialog_open = true,
                    Err(error) => eprintln!("Could not show avatar error dialog: {error:#}"),
                }
            }
        }
    }
    fn service(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        self.observe_settings(Instant::now(), false);
        if let Some(scene) = &mut self.scene {
            scene.refresh_visibility();
        }
        for command in std::mem::take(&mut self.commands) {
            match command {
                menu::Command::Quit => {
                    event_loop.exit();
                    return Ok(());
                }
                menu::Command::Open if !self.dialog_open => {
                    if let Some(scene) = &mut self.scene {
                        scene.set_visible(true);
                        let directory = if self.current_path.is_dir() {
                            Some(self.current_path.as_path())
                        } else {
                            self.current_path.parent()
                        };
                        match menu::open(self.proxy.clone(), &scene.window, directory) {
                            Ok(()) => self.dialog_open = true,
                            Err(error) => self.load_error(&format!("{error:#}")),
                        }
                    }
                }
                menu::Command::Recent(path) => {
                    if let Some(scene) = &mut self.scene {
                        scene.set_visible(true);
                    }
                    self.refresh_recent();
                    self.request_load(path);
                }
                menu::Command::Reload => self.request_load(self.current_path.clone()),
                menu::Command::Play(id) => {
                    if let Some(scene) = &mut self.scene {
                        scene.avatar.play(&id);
                    }
                }
                menu::Command::Expression(name) => {
                    if let Some(scene) = &mut self.scene {
                        scene.select_expression(&name);
                    }
                }
                menu::Command::ToggleVisible => {
                    let now = Instant::now();
                    self.observe_settings(now, true);
                    if let Some(scene) = &mut self.scene {
                        scene.set_visible(!scene.controls.visible);
                    }
                    // Hidden windows stop requesting frames, so finish any pending save now.
                    if let Err(error) = self.settings.flush(now, true) {
                        eprintln!("Could not save window settings: {error:#}");
                    }
                }
                menu::Command::ToggleClickThrough => {
                    if let Some(scene) = &mut self.scene {
                        scene.toggle_click_through();
                    }
                }
                menu::Command::ToggleMicrophone => {
                    self.microphone.set_enabled(!self.microphone.state.enabled)
                }
                menu::Command::MicrophoneDevice(device) => self.microphone.select(device),
                menu::Command::MicrophoneSensitivity(value) => self.microphone.sensitivity(value),
                menu::Command::RefreshMicrophones => self.microphone.refresh(),
                _ => {}
            }
        }
        if let Some(loaded) = self
            .pending_load
            .take()
            .filter(|loaded| self.loader.is_current(loaded))
        {
            match loaded
                .result
                .map_err(anyhow::Error::msg)
                .and_then(|package| {
                    catch_unwind(AssertUnwindSafe(|| {
                        self.scene
                            .as_mut()
                            .context("avatar window is unavailable")?
                            .replace_avatar(package)
                    }))
                    .unwrap_or_else(|_| Err(anyhow::anyhow!("could not prepare the new avatar")))
                }) {
                Ok(()) => {
                    self.current_path = loaded.path;
                    self.restore_settings(event_loop);
                    self.refresh_avatar_menu();
                    if let Err(error) = self.recent.record(&self.current_path) {
                        eprintln!("Could not save recent avatars: {error:#}");
                    }
                    self.refresh_recent();
                }
                Err(error) => self.load_error(&format!("{error:#}")),
            }
        }
        let mic_active = self.microphone.state.enabled && !self.microphone.state.starting;
        if let Some(scene) = &mut self.scene {
            if mic_active {
                if !self.mic_driving {
                    scene.avatar.stop_lip_sync();
                }
                let (level, speaking) = self.microphone.level(Instant::now());
                scene.avatar.set_speaking(speaking);
                scene.avatar.set_voice_level(level);
            } else if self.mic_driving {
                scene.avatar.set_voice_level(0.0);
                scene.avatar.set_speaking(false);
            }
        }
        self.mic_driving = mic_active;
        if let Some(menu) = &mut self.menu {
            if let Some(state) = self.microphone.take_state() {
                if let Err(error) = menu.update_microphone(&state) {
                    eprintln!("Could not update microphone menu: {error:#}");
                }
            }
        }
        if let Some(scene) = &mut self.scene {
            scene.service()?;
        }
        if let (Some(menu), Some(scene)) = (&mut self.menu, &self.scene) {
            menu.update_controls(scene.controls);
        }
        let now = Instant::now();
        self.observe_settings(now, false);
        if let Err(error) = self.settings.flush(now, false) {
            eprintln!("Could not save window settings: {error:#}");
        }
        Ok(())
    }
}
impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if let Some(scene) = &mut self.scene {
            scene.last_frame = Instant::now();
            scene.occluded = false;
            scene.pending_surface_size = Some(scene.window.inner_size());
            return;
        }
        if let Some(avatar) = self.avatar.take() {
            match pollster::block_on(Scene::new(event_loop, avatar)) {
                Ok(scene) => {
                    self.scene = Some(scene);
                    self.restore_settings(event_loop);
                    if let Err(error) = self.recent.record(&self.current_path) {
                        eprintln!("Could not save recent avatars: {error:#}");
                    }
                    match menu::AppMenu::install(self.proxy.clone(), self.recent.entries()) {
                        Ok(menu) => self.menu = Some(menu),
                        Err(error) => eprintln!("Could not install avatar menu: {error:#}"),
                    }
                    self.refresh_avatar_menu();
                    if let Some(scene) = &mut self.scene {
                        // Apply the restored layout while hidden to avoid a startup position flash.
                        scene.apply_window_changes();
                        scene.window.set_visible(true);
                        scene.window.focus_window();
                        scene.window.request_redraw();
                    }
                }
                Err(error) => {
                    self.error = Some(error);
                    event_loop.exit();
                }
            }
        }
    }
    fn window_event(&mut self, event_loop: &ActiveEventLoop, id: WindowId, event: WindowEvent) {
        let Some(scene) = &mut self.scene else {
            return;
        };
        if scene.window.id() != id {
            return;
        }
        match event {
            WindowEvent::DroppedFile(path) => self.commands.push(menu::Command::Recent(path)),
            WindowEvent::Focused(true) => self.refresh_recent(),
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => scene.pending_surface_size = Some(size),
            WindowEvent::ScaleFactorChanged { .. } => scene.scaling.refresh(scene.scale_bounds()),
            WindowEvent::Occluded(value) => {
                scene.occluded = value;
                scene.last_frame = Instant::now();
            }
            WindowEvent::Focused(false) => scene.modifiers = ModifiersState::empty(),
            WindowEvent::ModifiersChanged(value) => scene.modifiers = value.state(),
            WindowEvent::KeyboardInput { event, .. } if event.state == ElementState::Pressed => {
                if let PhysicalKey::Code(key) = event.physical_key {
                    let command = if cfg!(target_os = "macos") {
                        scene.modifiers.super_key()
                    } else {
                        scene.modifiers.control_key()
                    };
                    if command && !event.repeat && key == KeyCode::KeyO {
                        self.commands.push(menu::Command::Open);
                    } else if command && !event.repeat && key == KeyCode::KeyR {
                        self.commands.push(menu::Command::Reload);
                    } else if key == KeyCode::KeyK && self.microphone.state.enabled {
                        eprintln!("Disable the microphone before running the kana demo");
                    } else {
                        scene.key(event_loop, key, event.repeat);
                    }
                }
            }
            WindowEvent::MouseInput {
                state: ElementState::Pressed,
                button: MouseButton::Left,
                ..
            } => {
                if let Err(error) = scene.window.drag_window() {
                    eprintln!("Could not move window: {error}");
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                scene.scaling.scroll(delta, scene.scale_bounds());
            }
            WindowEvent::RedrawRequested => scene.redraw_requested = true,
            _ => {}
        }
    }
    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        // Contain unexpected backend panics before they cross an AppKit C ABI boundary.
        let result =
            catch_unwind(AssertUnwindSafe(|| self.service(event_loop))).unwrap_or_else(|payload| {
                let message = payload
                    .downcast_ref::<String>()
                    .map(String::as_str)
                    .or_else(|| payload.downcast_ref::<&str>().copied())
                    .unwrap_or("unknown graphics backend panic");
                Err(anyhow::anyhow!("desktop update failed: {message}"))
            });
        if let Err(error) = result {
            eprintln!("Desktop update stopped: {error:#}");
            self.error = Some(error);
            event_loop.exit();
        }
    }
    fn user_event(&mut self, _: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::Menu(id) => {
                if let Some(command) = self.menu.as_ref().and_then(|menu| menu.command(&id)) {
                    self.commands.push(command);
                }
            }
            UserEvent::Picked(path) => {
                self.dialog_open = false;
                if let Some(path) = path {
                    self.request_load(path);
                }
            }
            UserEvent::AlertClosed => self.dialog_open = false,
            UserEvent::Loaded(loaded) => {
                if self.loader.is_current(&loaded) {
                    self.pending_load = Some(*loaded);
                }
            }
            UserEvent::Microphone(event) => self.microphone.event(event),
        }
    }
    fn exiting(&mut self, _: &ActiveEventLoop) {
        self.microphone.set_enabled(false);
        let now = Instant::now();
        self.observe_settings(now, true);
        if let Err(error) = self.settings.flush(now, true) {
            eprintln!("Could not save window settings on exit: {error:#}");
        }
    }
}
fn run() -> Result<()> {
    let mut args = env::args_os().skip(1);
    let path = match args.next() {
        Some(value) if value == "--help" || value == "-h" => {
            println!("Usage: mesh-avatar-desktop [avatar.mavatar | project-folder]\nDefault: samples/miko-qipao in the source checkout.\nDrag to move; scroll/Cmd +/- to scale; 1–9 motions; E expressions; K kana; C click-through; Esc/Cmd+Q quit.");
            return Ok(());
        }
        Some(value) => PathBuf::from(value),
        None => default_sample()?,
    };
    ensure!(args.next().is_none(), "expected at most one avatar path");
    let path = loading::avatar_path(&path)?;
    let avatar = Avatar::open(&path)
        .context("Could not load avatar; a built project needs rig.json and built/ PNG assets")?;
    let mut builder = EventLoop::<UserEvent>::with_user_event();
    #[cfg(target_os = "macos")]
    {
        use winit::platform::macos::{ActivationPolicy, EventLoopBuilderExtMacOS};
        builder.with_activation_policy(ActivationPolicy::Regular);
    }
    let event_loop = builder.build()?;
    event_loop.set_control_flow(ControlFlow::Wait);
    let proxy = event_loop.create_proxy();
    let mic_notify = proxy.clone();
    let microphone = microphone::Microphone::new(move |event| {
        let _ = mic_notify.send_event(UserEvent::Microphone(event));
    })?;
    let notify = proxy.clone();
    let loader = Loader::new(move |loaded| {
        let _ = notify.send_event(UserEvent::Loaded(Box::new(loaded)));
    })?;
    let file = Recent::config_file();
    let recent = Recent::load(file.clone()).unwrap_or_else(|error| {
        eprintln!("Could not read recent avatars: {error:#}");
        Recent::empty(file)
    });
    let mut app = App {
        avatar: Some(avatar),
        scene: None,
        error: None,
        current_path: path,
        recent,
        loader,
        pending_load: None,
        proxy,
        menu: None,
        commands: Vec::new(),
        dialog_open: false,
        settings: Settings::load(Settings::config_file()),
        microphone,
        mic_driving: false,
    };
    event_loop.run_app(&mut app)?;
    if let Some(error) = app.error {
        return Err(error);
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("mesh-avatar-desktop: {error:#}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_aspect_preserves_top_crop_at_both_pixel_ratios() {
        let view = ViewOptions {
            image_size: [1254, 1254],
            pad_top: -0.07,
            pad_side: 0.0,
            fit: Fit::Contain,
        };
        let size = geometry::base_size(&view);
        assert!((size.height - 372.0).abs() < 1e-8);
        for dpr in [1.0, 2.0] {
            let physical: PhysicalSize<u32> = size.to_physical(dpr);
            let t = view.transform([physical.width, physical.height]).unwrap();
            let top = f64::from(physical.height) * (1.0 - f64::from(t[3])) / 2.0;
            assert!(top < -27.9 * dpr);
        }
        let adjusted = guarded_view(view, [400, 372], 120.0);
        let transform = adjusted.transform([400, 372]).unwrap();
        let scale = f64::from(transform[0]) * 400.0 / 2.0;
        let offset = 372.0 * (1.0 - f64::from(transform[3])) / 2.0;
        assert!(120.0 * scale + offset < -1.99);
        assert!((1254.0 * scale + offset - 372.0).abs() < 1e-3);
    }
}
mod audio_level;
