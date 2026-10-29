//! Logical window placement, monitor clamping and debounced atomic persistence.
use crate::{
    geometry::fit_base,
    scaling::{ScaleBounds, Scaling},
};
use anyhow::Result;
use mesh_avatar_wgpu::ViewOptions;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use winit::dpi::LogicalSize;

const SAVE_DELAY: Duration = Duration::from_millis(500);
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct Placement {
    pub position: [f64; 2],
    pub zoom: f64,
}
impl Placement {
    fn valid(&self) -> bool {
        self.position.iter().all(|n| n.is_finite()) && self.zoom.is_finite() && self.zoom > 0.0
    }
}
#[derive(Clone, Copy, Debug)]
pub struct Area {
    pub position: [f64; 2],
    pub size: [f64; 2],
    pub dpi: f64,
}
impl Area {
    pub fn valid(&self) -> bool {
        self.position.iter().all(|n| n.is_finite())
            && self.size.iter().all(|n| n.is_finite() && *n > 0.0)
            && self.dpi.is_finite()
            && self.dpi > 0.0
    }
}
pub struct Restored {
    pub position: [f64; 2],
    pub scaling: Scaling,
}
pub fn restore(
    view: &ViewOptions,
    placement: Placement,
    areas: &[Area],
    limit: u32,
) -> Option<Restored> {
    if !placement.valid() {
        return None;
    }
    let distance = |area: &Area| {
        let delta: [f64; 2] = std::array::from_fn(|i| {
            placement.position[i]
                - placement.position[i].clamp(area.position[i], area.position[i] + area.size[i])
        });
        delta[0].hypot(delta[1])
    };
    let area = areas
        .iter()
        .filter(|area| area.valid())
        .min_by(|a, b| distance(a).total_cmp(&distance(b)))?;
    let screen = LogicalSize::new(area.size[0], area.size[1]);
    let base = fit_base(view, Some(screen)).ok()?;
    let mut scaling = Scaling::from_zoom(
        base,
        placement.zoom,
        ScaleBounds {
            dpi: area.dpi,
            screen: Some(screen),
            texture_limit: limit,
        },
    )
    .ok()?;
    // Match the rounded physical size that will actually be requested from the OS.
    let size = scaling.clone().take_request()?;
    let dimensions = [
        f64::from(size.width) / area.dpi,
        f64::from(size.height) / area.dpi,
    ];
    let position = std::array::from_fn(|i| {
        placement.position[i].clamp(
            area.position[i],
            area.position[i] + (area.size[i] - dimensions[i]).max(0.0),
        )
    });
    // Keep the request queued for the normal resize path.
    scaling.refresh(ScaleBounds {
        dpi: area.dpi,
        screen: Some(screen),
        texture_limit: limit,
    });
    Some(Restored { position, scaling })
}

#[derive(Default, Deserialize, Serialize)]
#[serde(default)]
struct Data {
    global: Option<Placement>,
    avatars: BTreeMap<PathBuf, Placement>,
}
pub struct Settings {
    file: Option<PathBuf>,
    data: Data,
    dirty_at: Option<Instant>,
}
impl Settings {
    pub fn config_file() -> Option<PathBuf> {
        dirs::config_dir().map(|dir| dir.join("mesh-avatar-desktop/settings.json"))
    }
    pub fn load(file: Option<PathBuf>) -> Self {
        let read = |file: &Path| -> Result<Data> {
            let mut bytes = Vec::new();
            fs::File::open(file)?
                .take(1024 * 1024 + 1)
                .read_to_end(&mut bytes)?;
            anyhow::ensure!(bytes.len() <= 1024 * 1024, "window settings are too large");
            Ok(serde_json::from_slice(&bytes)?)
        };
        let mut data = file
            .as_ref()
            .filter(|p| p.exists())
            .and_then(|file| match read(file) {
                Ok(data) => Some(data),
                Err(error) => {
                    eprintln!("Ignoring invalid window settings: {error:#}");
                    None
                }
            })
            .unwrap_or_default();
        data.global = data.global.filter(Placement::valid);
        data.avatars.retain(|_, p| p.valid());
        Self {
            file,
            data,
            dirty_at: None,
        }
    }
    pub fn placement(&self, path: &Path) -> Option<Placement> {
        self.data.avatars.get(path).copied().or(self.data.global)
    }
    pub fn record(&mut self, path: &Path, placement: Placement, now: Instant) {
        if !placement.valid() {
            return;
        }
        if self.data.avatars.get(path) == Some(&placement) && self.data.global == Some(placement) {
            return;
        }
        self.data.avatars.insert(path.to_path_buf(), placement);
        self.data.global = Some(placement);
        self.dirty_at = Some(now);
    }
    pub fn flush(&mut self, now: Instant, force: bool) -> Result<()> {
        let Some(dirty) = self.dirty_at else {
            return Ok(());
        };
        if !force && now.saturating_duration_since(dirty) < SAVE_DELAY {
            return Ok(());
        }
        self.dirty_at = Some(now); // Back off after a filesystem error instead of logging each frame.
        if let Some(file) = &self.file {
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent)?;
            }
            let temporary = file.with_extension(format!("json.{}.tmp", std::process::id()));
            let result = fs::write(&temporary, serde_json::to_vec_pretty(&self.data)?)
                .and_then(|_| fs::rename(&temporary, file));
            if result.is_err() {
                let _ = fs::remove_file(temporary);
            }
            result?;
        }
        self.dirty_at = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mesh_avatar_wgpu::Fit;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mesh-avatar-settings-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn roundtrip_per_avatar_fallback_debounce_and_forced_quit_save() {
        let fixture = Fixture::new();
        let file = fixture.0.join("settings.json");
        let mut settings = Settings::load(Some(file.clone()));
        let now = Instant::now();
        let a = Placement {
            position: [-1200.5, 40.25],
            zoom: 1.5,
        };
        let b = Placement {
            position: [100.0, 200.0],
            zoom: 0.5,
        };
        settings.record(Path::new("first.mavatar"), a, now);
        settings
            .flush(now + Duration::from_millis(499), false)
            .unwrap();
        assert!(!file.exists());
        settings.record(
            Path::new("second.mavatar"),
            b,
            now + Duration::from_millis(400),
        );
        settings
            .flush(now + Duration::from_millis(600), false)
            .unwrap();
        assert!(!file.exists());
        settings
            .flush(now + Duration::from_millis(901), false)
            .unwrap();
        let restored = Settings::load(Some(file.clone()));
        assert_eq!(restored.placement(Path::new("first.mavatar")), Some(a));
        assert_eq!(restored.placement(Path::new("unknown.mavatar")), Some(b));
        settings.record(Path::new("first.mavatar"), b, now + Duration::from_secs(1));
        settings.flush(now + Duration::from_secs(1), true).unwrap();
        assert_eq!(
            Settings::load(Some(file)).placement(Path::new("first.mavatar")),
            Some(b)
        );
    }
    #[test]
    fn corrupt_missing_and_invalid_settings_do_not_prevent_startup() {
        let fixture = Fixture::new();
        let file = fixture.0.join("settings.json");
        assert!(Settings::load(Some(file.clone()))
            .placement(Path::new("avatar"))
            .is_none());
        for bytes in ["broken", r#"{"global":{"position":[0,0],"zoom":-2}}"#] {
            fs::write(&file, bytes).unwrap();
            assert!(Settings::load(Some(file.clone()))
                .placement(Path::new("avatar"))
                .is_none());
        }
    }
    #[test]
    fn failed_atomic_write_keeps_previous_file_and_can_retry() {
        let fixture = Fixture::new();
        let file = fixture.0.join("settings.json");
        fs::create_dir(&file).unwrap();
        let mut settings = Settings::load(Some(file.clone()));
        let now = Instant::now();
        let p = Placement {
            position: [10.0, 20.0],
            zoom: 1.0,
        };
        settings.record(Path::new("avatar"), p, now);
        assert!(settings.flush(now, true).is_err());
        assert!(file.is_dir());
        fs::remove_dir(&file).unwrap();
        settings.flush(now, true).unwrap();
        assert_eq!(
            Settings::load(Some(file)).placement(Path::new("avatar")),
            Some(p)
        );
    }
    #[test]
    fn removed_monitor_negative_coordinates_and_mixed_dpi_stay_visible() {
        let view = ViewOptions {
            image_size: [1254, 1254],
            pad_top: -0.07,
            pad_side: 0.0,
            fit: Fit::Contain,
        };
        let areas = [
            Area {
                position: [0.0, 25.0],
                size: [1440.0, 820.0],
                dpi: 2.0,
            },
            Area {
                position: [-1920.0, 0.0],
                size: [1920.0, 1040.0],
                dpi: 1.0,
            },
        ];
        for point in [[-1800.0, 50.0], [7000.0, -4000.0], [1439.0, 819.0]] {
            let restored = restore(
                &view,
                Placement {
                    position: point,
                    zoom: 4.0,
                },
                &areas,
                8192,
            )
            .unwrap();
            let mut scaling = restored.scaling;
            let size = scaling.take_request().unwrap();
            assert!(areas.iter().any(|a| restored.position[0] >= a.position[0]
                && restored.position[1] >= a.position[1]
                && restored.position[0] + f64::from(size.width) / a.dpi
                    <= a.position[0] + a.size[0] + 1e-8
                && restored.position[1] + f64::from(size.height) / a.dpi
                    <= a.position[1] + a.size[1] + 1e-8));
        }
        let restored = restore(
            &view,
            Placement {
                position: [-1800.0, 50.0],
                zoom: 1.5,
            },
            &areas,
            8192,
        )
        .unwrap();
        assert_eq!(restored.position, [-1800.0, 50.0]);
        assert_eq!(restored.scaling.zoom(), 1.5);
        let restored = restore(
            &view,
            Placement {
                position: [-1800.0, 50.0],
                zoom: 1.5,
            },
            &areas[..1],
            8192,
        )
        .unwrap();
        assert_eq!(restored.position[0], 0.0);
        assert!(restore(
            &view,
            Placement {
                position: [0.0, 0.0],
                zoom: 1.0
            },
            &[],
            8192
        )
        .is_none());
    }
}
