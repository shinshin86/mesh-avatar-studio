//! A small original avatar silhouette, rendered as a macOS template image.
#[cfg(any(target_os = "macos", test))]
fn icon_rgba() -> Vec<u8> {
    let mut rgba = vec![0; 36 * 36 * 4];
    for y in 0..36 {
        for x in 0..36 {
            let dx = x as f64 + 0.5 - 18.0;
            let py = y as f64 + 0.5;
            let head = dx * dx + (py - 11.0).powi(2) <= 7.5_f64.powi(2);
            let shoulders = (23.0..=33.0).contains(&py)
                && (dx / 13.0).powi(2) + ((py - 31.0) / 9.0).powi(2) <= 1.0;
            let eyes = (9.0..=12.0).contains(&py) && (dx.abs() - 3.0).abs() <= 1.0;
            if (head || shoulders) && !eyes {
                rgba[(y * 36 + x) * 4 + 3] = 255;
            }
        }
    }
    rgba
}

#[cfg(target_os = "macos")]
pub struct StatusBar {
    _icon: tray_icon::TrayIcon,
    visibility: muda::MenuItem,
    click_through: muda::CheckMenuItem,
    last_visible: Option<bool>,
}
#[cfg(target_os = "macos")]
impl StatusBar {
    pub fn new(
        recent: &muda::Submenu,
        open: &muda::MenuItem,
        quit: &muda::MenuItem,
        microphone: &muda::Submenu,
    ) -> anyhow::Result<Self> {
        use muda::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
        let menu = Menu::new();
        let visibility = MenuItem::with_id("toggle-visible", "Hide Avatar", true, None);
        let click_through =
            CheckMenuItem::with_id("toggle-click-through", "Click-through", true, false, None);
        menu.append_items(&[
            &visibility,
            &click_through,
            microphone,
            &PredefinedMenuItem::separator(),
            open,
            recent,
            &PredefinedMenuItem::separator(),
            quit,
        ])?;
        let icon = tray_icon::Icon::from_rgba(icon_rgba(), 36, 36)?;
        // Only menu actions are used; avoid retaining unused pointer-move events.
        tray_icon::TrayIconEvent::set_event_handler(Some(|_: tray_icon::TrayIconEvent| {}));
        let icon = tray_icon::TrayIconBuilder::new()
            .with_tooltip("Mesh Avatar")
            .with_icon(icon)
            .with_icon_as_template(true)
            .with_menu(Box::new(menu))
            .with_menu_on_left_click(true)
            .with_menu_on_right_click(true)
            .build()?;
        Ok(Self {
            _icon: icon,
            visibility,
            click_through,
            last_visible: None,
        })
    }
    pub fn update(&mut self, state: crate::window_controls::WindowControls) {
        if self.last_visible != Some(state.visible) {
            self.visibility.set_text(state.visibility_label());
            self.last_visible = Some(state.visible);
        }
        // A native check item toggles before its callback. Restore it if the OS call failed.
        if self.click_through.is_checked() != state.click_through {
            self.click_through.set_checked(state.click_through);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn template_is_nonempty_monochrome_symmetric_and_has_transparent_margin() {
        let pixels = icon_rgba();
        assert_eq!(pixels.len(), 36 * 36 * 4);
        let painted = pixels
            .as_chunks::<4>()
            .0
            .iter()
            .filter(|p| p[3] != 0)
            .count();
        assert!((200..600).contains(&painted));
        for y in 0..36 {
            for x in 0..36 {
                let p = &pixels[(y * 36 + x) * 4..(y * 36 + x) * 4 + 4];
                assert_eq!(&p[..3], &[0, 0, 0]);
                assert_eq!(p[3], pixels[(y * 36 + 35 - x) * 4 + 3]);
                if x == 0 || y == 0 || x == 35 || y == 35 {
                    assert_eq!(p[3], 0);
                }
            }
        }
    }
}
