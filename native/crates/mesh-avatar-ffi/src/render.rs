//! Optional headless rendering. Every exported function requires the render feature.
use crate::{
    boundary::{boundary, check_out, Error, Result},
    state,
    types::*,
};
use mesh_avatar_wgpu::{wgpu, Fit, Renderer, ViewOptions};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, OnceLock},
};

/// Opaque renderer token. Uses a separate registry from avatar handles; zero is invalid.
pub type MaRenderer = u64;
pub const MA_GPU_UNAVAILABLE: MaStatus = 7;
pub const MA_RENDER_ERROR: MaStatus = 8;
pub const MA_FIT_CONTAIN: u32 = 0;
pub const MA_FIT_COVER: u32 = 1;
pub const MA_RGBA_STRAIGHT: u32 = 0;
pub const MA_RGBA_PREMULTIPLIED: u32 = 1;

/// Physical output pixels, MSAA samples (1 or 4), fit and explicit viewport padding.
/// Use mesh_avatar_get_info to obtain the avatar's recommended pad_top/pad_side.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MaRenderOptions {
    pub width: u32,
    pub height: u32,
    pub samples: u32,
    /// MA_FIT_CONTAIN or MA_FIT_COVER.
    pub fit: u32,
    /// Finite and greater than -1.
    pub pad_top: f64,
    /// Finite and greater than -0.5.
    pub pad_side: f64,
}

struct RenderEntry {
    renderer: Renderer,
    device: wgpu::Device,
    avatar: MaHandle,
    size: [u32; 2],
    view: ViewOptions,
    alive: bool,
}
type RenderEntries = BTreeMap<MaRenderer, Arc<Mutex<RenderEntry>>>;
static RENDERERS: OnceLock<Mutex<RenderEntries>> = OnceLock::new();
fn renderers() -> &'static Mutex<RenderEntries> {
    RENDERERS.get_or_init(|| Mutex::new(BTreeMap::new()))
}
fn with_renderer<T>(id: MaRenderer, work: impl FnOnce(&mut RenderEntry) -> Result<T>) -> Result<T> {
    let shared = renderers()
        .lock()
        .map_err(|_| Error::new(MA_INVALID_STATE, "renderer registry is poisoned"))?
        .get(&id)
        .cloned()
        .ok_or_else(|| Error::new(MA_INVALID_HANDLE, "invalid or destroyed renderer"))?;
    let mut entry = shared.lock().map_err(|_| {
        Error::new(
            MA_INVALID_STATE,
            "renderer panicked; destroy and recreate it",
        )
    })?;
    if !entry.alive {
        return Err(Error::new(MA_INVALID_HANDLE, "destroyed renderer"));
    }
    work(&mut entry)
}
fn rgba_length(size: [u32; 2]) -> Result<usize> {
    let bytes = u64::from(size[0]) * u64::from(size[1]);
    let bytes = bytes.checked_mul(4).filter(|&n| {
        // The shared renderer also uses u32 pixel arithmetic internally.
        n <= u64::from(u32::MAX) && n <= isize::MAX as u64
    });
    if size.contains(&0) || bytes.is_none() {
        return Err(Error::new(MA_INVALID_ARGUMENT, "invalid output dimensions"));
    }
    Ok(bytes.unwrap() as usize)
}
fn validate_target(size: [u32; 2], view: &ViewOptions, limits: &wgpu::Limits) -> Result<usize> {
    let length = rgba_length(size)?;
    let transform = view
        .transform(size)
        .map_err(|e| Error::new(MA_INVALID_ARGUMENT, e.to_string()))?;
    let stride = (u64::from(size[0]) * 4).div_ceil(256) * 256;
    if !transform.iter().all(|v| v.is_finite())
        || size.iter().any(|&v| v > limits.max_texture_dimension_2d)
        || stride * u64::from(size[1]) > limits.max_buffer_size
    {
        return Err(Error::new(
            MA_INVALID_ARGUMENT,
            "output exceeds GPU texture/buffer limits or has an invalid transform",
        ));
    }
    Ok(length)
}
fn render_error(error: impl std::fmt::Display) -> Error {
    Error::new(MA_RENDER_ERROR, format!("GPU render error: {error}"))
}

/// Create a headless renderer bound to avatar's textures. Requires the render feature.
/// Returns MA_GPU_UNAVAILABLE only when no compatible adapter can be found; otherwise
/// GPU initialization failures return MA_RENDER_ERROR. On failure *out is zero.
/// Calls on a renderer are serialized; it may move between threads. It does not own
/// the avatar. Destroy the renderer before the avatar; rendering a destroyed avatar fails.
/// # Safety
/// options must be readable/aligned; out writable/aligned. Pointers must not alias.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_renderer_create(
    avatar: MaHandle,
    options: *const MaRenderOptions,
    out: *mut MaRenderer,
) -> MaStatus {
    boundary(|| {
        check_out(out)?;
        // SAFETY: Caller provides a writable output slot; checked for NULL/alignment.
        unsafe { out.write(0) };
        state::with_entry(avatar, |entry| {
            check_out(options.cast_mut())?;
            // SAFETY: Caller supplies a readable/aligned options value.
            let options = unsafe { options.read() };
            let size = [options.width, options.height];
            rgba_length(size)?;
            if !matches!(options.samples, 1 | 4) {
                return Err(Error::new(MA_INVALID_ARGUMENT, "samples must be 1 or 4"));
            }
            let fit = match options.fit {
                MA_FIT_CONTAIN => Fit::Contain,
                MA_FIT_COVER => Fit::Cover,
                _ => return Err(Error::new(MA_INVALID_ARGUMENT, "unknown fit mode")),
            };
            let image = &entry.avatar.package().rig.image;
            let view = ViewOptions {
                image_size: [image.width, image.height],
                pad_top: options.pad_top,
                pad_side: options.pad_side,
                fit,
            };
            view.transform(size)
                .map_err(|e| Error::new(MA_INVALID_ARGUMENT, e.to_string()))?;
            let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
            let adapter =
                pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
                    power_preference: wgpu::PowerPreference::HighPerformance,
                    compatible_surface: None,
                    force_fallback_adapter: false,
                }))
                .map_err(|e| {
                    Error::new(
                        MA_GPU_UNAVAILABLE,
                        format!("no compatible GPU adapter: {e}"),
                    )
                })?;
            let format = wgpu::TextureFormat::Rgba8Unorm;
            if !adapter
                .get_texture_format_features(format)
                .flags
                .sample_count_supported(options.samples)
            {
                return Err(render_error("requested MSAA count is unavailable"));
            }
            let (device, queue) =
                pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
                    label: Some("mesh avatar C renderer"),
                    ..Default::default()
                }))
                .map_err(render_error)?;
            validate_target(size, &view, &device.limits())?;
            let renderer = Renderer::new(
                &device,
                &queue,
                format,
                options.samples,
                entry.avatar.textures(),
            )
            .map_err(render_error)?;
            let id = state::allocate_handle()?;
            renderers()
                .lock()
                .map_err(|_| Error::new(MA_INVALID_STATE, "renderer registry is poisoned"))?
                .insert(
                    id,
                    Arc::new(Mutex::new(RenderEntry {
                        renderer,
                        device,
                        avatar,
                        size,
                        view,
                        alive: true,
                    })),
                );
            // SAFETY: Validated caller-owned slot.
            unsafe { out.write(id) };
            Ok(())
        })
    })
}

/// Render the current cached frame without ticking or invalidating borrowed geometry.
/// Requires the render feature. rgba must hold at least width*height*4 bytes for the
/// current size. Writes tightly packed RGBA8, top row first, with transparent clear.
/// alpha_mode is MA_RGBA_STRAIGHT or MA_RGBA_PREMULTIPLIED. Extra bytes are untouched.
/// The synchronous call waits for readback. The buffer is never retained and remains
/// unchanged on failure. The caller must synchronize concurrent access to its buffer.
/// Calls acquire the renderer before the avatar lock; tick/render/destroy are serialized.
/// # Safety
/// rgba must be writable for length bytes, non-NULL, and must not alias library storage.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_renderer_render(
    renderer: MaRenderer,
    rgba: *mut u8,
    length: usize,
    alpha_mode: u32,
) -> MaStatus {
    boundary(|| {
        with_renderer(renderer, |entry| {
            let needed = rgba_length(entry.size)?;
            if rgba.is_null()
                || length < needed
                || length > isize::MAX as usize
                || !matches!(alpha_mode, MA_RGBA_STRAIGHT | MA_RGBA_PREMULTIPLIED)
            {
                return Err(Error::new(
                    MA_INVALID_ARGUMENT,
                    "invalid output buffer or alpha mode",
                ));
            }
            // A renderer lock is always taken before an avatar lock; no API reverses this order.
            state::with_entry(entry.avatar, |avatar| {
                let frame = avatar
                    .frame
                    .as_ref()
                    .ok_or_else(|| Error::new(MA_INVALID_STATE, "no current avatar frame"))?;
                let pixels = if alpha_mode == MA_RGBA_STRAIGHT {
                    entry
                        .renderer
                        .render_rgba(frame.frame(), entry.size, &entry.view)
                } else {
                    entry
                        .renderer
                        .render_rgba_premultiplied(frame.frame(), entry.size, &entry.view)
                }
                .map_err(render_error)?;
                if pixels.len() != needed {
                    return Err(render_error("unexpected readback size"));
                }
                // SAFETY: Caller guarantees writable/nonaliasing memory; size was checked above.
                unsafe { std::ptr::copy_nonoverlapping(pixels.as_ptr(), rgba, needed) };
                Ok(())
            })
        })
    })
}

/// Change physical output size, keeping fit/padding/MSAA. Requires the render feature.
/// Invalid sizes leave the renderer unchanged. Reallocate caller buffers before rendering.
#[no_mangle]
pub extern "C" fn mesh_avatar_renderer_resize(
    renderer: MaRenderer,
    width: u32,
    height: u32,
) -> MaStatus {
    boundary(|| {
        with_renderer(renderer, |entry| {
            validate_target([width, height], &entry.view, &entry.device.limits())?;
            entry.size = [width, height];
            Ok(())
        })
    })
}

/// Destroy a renderer from any thread, including after a contained panic.
/// Requires the render feature. Rejects zero, unknown or destroyed tokens.
#[no_mangle]
pub extern "C" fn mesh_avatar_renderer_destroy(renderer: MaRenderer) -> MaStatus {
    boundary(|| {
        let shared = renderers()
            .lock()
            .map_err(|_| Error::new(MA_INVALID_STATE, "renderer registry is poisoned"))?
            .remove(&renderer)
            .ok_or_else(|| Error::new(MA_INVALID_HANDLE, "invalid or destroyed renderer"))?;
        let mut entry = shared
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        entry.alive = false;
        Ok(())
    })
}

#[cfg(test)]
mod tests;
