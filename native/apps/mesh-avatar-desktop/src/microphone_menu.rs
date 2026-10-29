//! One microphone submenu shared by the app menu and status icon.
#[cfg(target_os = "macos")]
pub struct MicrophoneMenu {
    pub submenu: muda::Submenu,
    toggle: muda::CheckMenuItem,
    status: muda::MenuItem,
    devices: muda::Submenu,
    choices: Vec<(muda::CheckMenuItem, Option<String>)>,
    sensitivities: Vec<(muda::CheckMenuItem, crate::audio_level::Sensitivity)>,
    state: Option<crate::microphone::State>,
}
#[cfg(target_os = "macos")]
impl MicrophoneMenu {
    pub fn new() -> anyhow::Result<Self> {
        use crate::audio_level::Sensitivity;
        use muda::{CheckMenuItem, MenuItem, Submenu};
        let submenu = Submenu::new("Microphone", true);
        let toggle = CheckMenuItem::with_id("mic-toggle", "Enable Microphone", true, false, None);
        let status = MenuItem::new("Off", false, None);
        let devices = Submenu::new("Input Device", true);
        let sensitivity = Submenu::new("Sensitivity", true);
        let mut sensitivities = vec![];
        for value in Sensitivity::ALL {
            let item = CheckMenuItem::with_id(
                format!("mic-sensitivity:{}", value.name()),
                value.name(),
                true,
                value == Sensitivity::Normal,
                None,
            );
            sensitivity.append(&item)?;
            sensitivities.push((item, value));
        }
        submenu.append_items(&[&toggle, &status, &devices, &sensitivity])?;
        let mut menu = Self {
            submenu,
            toggle,
            status,
            devices,
            choices: vec![],
            sensitivities,
            state: None,
        };
        menu.update(&crate::microphone::State::default())?;
        Ok(menu)
    }
    pub fn update(&mut self, state: &crate::microphone::State) -> anyhow::Result<()> {
        use muda::{CheckMenuItem, MenuItem, PredefinedMenuItem};
        self.toggle.set_checked(state.enabled);
        self.status.set_text(state.status.replace('&', "&&"));
        if self
            .state
            .as_ref()
            .is_none_or(|old| old.devices != state.devices || old.selected != state.selected)
        {
            while self.devices.remove_at(0).is_some() {}
            self.choices.clear();
            let default = CheckMenuItem::with_id(
                "mic-default",
                "System Default",
                true,
                state.selected.is_none(),
                None,
            );
            self.devices.append(&default)?;
            self.choices.push((default, None));
            for device in &state.devices {
                let item = CheckMenuItem::with_id(
                    format!("mic-input:{}", device.id),
                    device.name.replace('&', "&&"),
                    true,
                    state.selected.as_ref() == Some(&device.id),
                    None,
                );
                self.devices.append(&item)?;
                self.choices.push((item, Some(device.id.clone())));
            }
            if state
                .selected
                .as_ref()
                .is_some_and(|id| !state.devices.iter().any(|d| &d.id == id))
            {
                self.devices.append(&CheckMenuItem::new(
                    "Selected input unavailable",
                    false,
                    true,
                    None,
                ))?;
            }
            self.devices.append_items(&[
                &PredefinedMenuItem::separator(),
                &MenuItem::with_id("mic-refresh", "Refresh Devices", true, None),
            ])?;
        }
        // Restore radio choices even if a native check item just toggled itself.
        for (item, selected) in &self.choices {
            item.set_checked(selected == &state.selected);
        }
        for (item, value) in &self.sensitivities {
            item.set_checked(*value == state.sensitivity);
        }
        self.state = Some(state.clone());
        Ok(())
    }
    pub fn command(&self, id: &str) -> Option<crate::menu::Command> {
        use crate::menu::Command;
        match id {
            "mic-toggle" => Some(Command::ToggleMicrophone),
            "mic-default" => Some(Command::MicrophoneDevice(None)),
            "mic-refresh" => Some(Command::RefreshMicrophones),
            _ => self
                .choices
                .iter()
                .find(|(item, _)| item.id().as_ref() == id)
                .map(|(_, device)| Command::MicrophoneDevice(device.clone()))
                .or_else(|| {
                    self.sensitivities
                        .iter()
                        .find(|(item, _)| item.id().as_ref() == id)
                        .map(|(_, value)| Command::MicrophoneSensitivity(*value))
                }),
        }
    }
}
