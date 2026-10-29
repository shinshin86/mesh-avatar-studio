//! Shared state for keyboard and status-menu window controls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WindowControls {
    pub visible: bool,
    pub click_through: bool,
}
impl Default for WindowControls {
    fn default() -> Self {
        Self {
            visible: true,
            click_through: false,
        }
    }
}
impl WindowControls {
    pub fn visibility_label(self) -> &'static str {
        if self.visible {
            "Hide Avatar"
        } else {
            "Show Avatar"
        }
    }
    pub fn set_click_through<E>(
        &mut self,
        enabled: bool,
        apply: impl FnOnce(bool) -> Result<(), E>,
    ) -> Result<(), E> {
        apply(enabled)?;
        self.click_through = enabled;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn click_through_can_be_recovered_while_hidden_without_changing_visibility() {
        let mut state = WindowControls::default();
        assert_eq!(state.visibility_label(), "Hide Avatar");
        state.set_click_through(true, |_| Ok::<_, ()>(())).unwrap();
        state.visible = false;
        assert_eq!(state.visibility_label(), "Show Avatar");
        state.set_click_through(false, |_| Ok::<_, ()>(())).unwrap();
        assert!(!state.visible && !state.click_through);
        state.visible = true;
        assert_eq!(state, WindowControls::default());
    }
    #[test]
    fn failed_native_toggle_keeps_the_checkmark_state() {
        let mut state = WindowControls::default();
        assert!(state
            .set_click_through(true, |_| Err("unsupported"))
            .is_err());
        assert!(!state.click_through);
        state.set_click_through(true, |_| Ok::<_, ()>(())).unwrap();
        assert!(state
            .set_click_through(false, |_| Err("unsupported"))
            .is_err());
        assert!(state.click_through);
    }
}
