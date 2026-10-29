//! Safe logical work areas; no native objects escape this module.
use crate::settings::Area;
use winit::event_loop::ActiveEventLoop;

pub fn visible_areas(event_loop: &ActiveEventLoop) -> Vec<Area> {
    #[cfg(target_os = "macos")]
    if let Some(areas) = macos_areas() {
        return areas;
    }
    event_loop
        .available_monitors()
        .filter_map(|monitor| {
            let dpi = monitor.scale_factor();
            let position = monitor.position().to_logical::<f64>(dpi);
            let size = monitor.size().to_logical::<f64>(dpi);
            let area = Area {
                position: [position.x, position.y],
                size: [size.width, size.height],
                dpi,
            };
            area.valid().then_some(area)
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn macos_areas() -> Option<Vec<Area>> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSScreen;
    let screens = NSScreen::screens(MainThreadMarker::new()?);
    // Cocoa's first screen defines the origin used by winit's screen coordinates.
    let primary_height = screens.firstObject()?.frame().size.height;
    let areas: Vec<_> = screens
        .iter()
        .filter_map(|screen| {
            let frame = screen.visibleFrame();
            let area = Area {
                position: [
                    frame.origin.x,
                    primary_height - frame.origin.y - frame.size.height,
                ],
                size: [frame.size.width, frame.size.height],
                dpi: screen.backingScaleFactor(),
            };
            area.valid().then_some(area)
        })
        .collect();
    (!areas.is_empty()).then_some(areas)
}
