//! Avatar input validation, background I/O, and the successful-open history.
use anyhow::{ensure, Context, Result};
use mesh_avatar_core::format::AvatarPackage;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
};

const RECENT_LIMIT: usize = 8;

pub fn avatar_path(path: &Path) -> Result<PathBuf> {
    let path = path.canonicalize().context("avatar path is unavailable")?;
    if path.is_dir() {
        ensure!(
            path.join("rig.json").is_file() && path.join("built").is_dir(),
            "a project folder must contain rig.json and built/"
        );
    } else {
        ensure!(
            path.is_file()
                && path
                    .extension()
                    .is_some_and(|s| s.eq_ignore_ascii_case("mavatar")),
            "choose a .mavatar archive or a built project folder"
        );
    }
    Ok(path)
}

pub struct Loaded {
    pub generation: u64,
    pub path: PathBuf,
    pub result: Result<AvatarPackage, String>,
}

/// One worker serializes I/O and skips superseded queued requests.
pub struct Loader {
    requests: mpsc::Sender<(u64, PathBuf)>,
    generation: u64,
}
impl Loader {
    pub fn new(notify: impl Fn(Loaded) + Send + 'static) -> Result<Self> {
        let (requests, receiver) = mpsc::channel::<(u64, PathBuf)>();
        thread::Builder::new()
            .name("avatar loader".into())
            .spawn(move || {
                while let Ok(mut request) = receiver.recv() {
                    for newer in receiver.try_iter() {
                        request = newer;
                    }
                    let (generation, requested) = request;
                    let loaded = std::panic::catch_unwind(|| {
                        avatar_path(&requested).and_then(|path| {
                            let package = AvatarPackage::open(&path)?;
                            Ok((path, package))
                        })
                    })
                    .unwrap_or_else(|_| Err(anyhow::anyhow!("avatar decoder failed unexpectedly")));
                    let (path, result) = match loaded {
                        Ok((path, package)) => (path, Ok(package)),
                        Err(error) => (requested, Err(format!("{error:#}"))),
                    };
                    notify(Loaded {
                        generation,
                        path,
                        result,
                    });
                }
            })?;
        Ok(Self {
            requests,
            generation: 0,
        })
    }
    pub fn request(&mut self, path: PathBuf) -> Result<()> {
        let generation = self.generation.wrapping_add(1);
        self.requests
            .send((generation, path))
            .context("avatar loader stopped")?;
        self.generation = generation;
        Ok(())
    }
    pub fn is_current(&self, loaded: &Loaded) -> bool {
        self.generation == loaded.generation
    }
}

pub struct Recent {
    file: Option<PathBuf>,
    entries: Vec<PathBuf>,
}
impl Recent {
    pub fn config_file() -> Option<PathBuf> {
        dirs::config_dir().map(|dir| dir.join("mesh-avatar-desktop/recent.json"))
    }
    pub fn empty(file: Option<PathBuf>) -> Self {
        Self {
            file,
            entries: Vec::new(),
        }
    }
    pub fn load(file: Option<PathBuf>) -> Result<Self> {
        let mut recent = Self::empty(file);
        if let Some(file) = &recent.file {
            match fs::read(file) {
                Ok(bytes) => {
                    ensure!(bytes.len() <= 65536, "recent avatar list is too large");
                    recent.entries =
                        serde_json::from_slice(&bytes).context("invalid recent avatar list")?;
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(recent),
                Err(error) => return Err(error.into()),
            }
        }
        if recent.prune() {
            recent.save()?;
        }
        Ok(recent)
    }
    pub fn entries(&self) -> &[PathBuf] {
        &self.entries
    }
    pub fn prune(&mut self) -> bool {
        let mut entries = Vec::new();
        for path in &self.entries {
            if let Ok(path) = avatar_path(path) {
                if !entries.contains(&path) {
                    entries.push(path);
                }
            }
            if entries.len() == RECENT_LIMIT {
                break;
            }
        }
        let changed = entries != self.entries;
        self.entries = entries;
        changed
    }
    pub fn record(&mut self, path: &Path) -> Result<()> {
        let path = avatar_path(path)?;
        self.entries.retain(|entry| entry != &path);
        self.entries.insert(0, path);
        self.prune();
        self.save()
    }
    pub fn save(&self) -> Result<()> {
        if let Some(file) = &self.file {
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent)?;
            }
            let temporary = file.with_extension("json.tmp");
            fs::write(&temporary, serde_json::to_vec_pretty(&self.entries)?)?;
            fs::rename(&temporary, file)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::atomic::{AtomicU64, Ordering},
        time::Duration,
    };
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "mesh-avatar-open-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn archive(&self, name: &str) -> PathBuf {
            let path = self.0.join(format!("{name}.mavatar"));
            fs::write(&path, b"not an archive").unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn inputs_require_archive_extension_or_built_project() {
        let fixture = Fixture::new();
        let archive = fixture.archive("avatar");
        assert_eq!(
            avatar_path(&archive).unwrap(),
            archive.canonicalize().unwrap()
        );
        assert!(avatar_path(&fixture.0).is_err());
        fs::write(fixture.0.join("rig.json"), b"{}").unwrap();
        fs::create_dir(fixture.0.join("built")).unwrap();
        assert!(avatar_path(&fixture.0).is_ok());
        let text = fixture.0.join("avatar.txt");
        fs::write(&text, b"invalid").unwrap();
        assert!(avatar_path(&text).is_err());
        assert!(avatar_path(&fixture.0.join("missing.mavatar")).is_err());
    }

    #[test]
    fn recent_roundtrip_orders_deduplicates_caps_and_prunes_missing_entries() {
        let fixture = Fixture::new();
        let file = fixture.0.join("config/recent.json");
        let mut recent = Recent::load(Some(file.clone())).unwrap();
        assert!(!file.exists());
        let paths: Vec<_> = (0..12).map(|i| fixture.archive(&i.to_string())).collect();
        for path in &paths {
            recent.record(path).unwrap();
        }
        recent.record(&paths[8]).unwrap();
        assert_eq!(recent.entries.len(), 8);
        assert_eq!(recent.entries[0], paths[8].canonicalize().unwrap());
        fs::remove_file(&paths[8]).unwrap();
        let restored = Recent::load(Some(file.clone())).unwrap();
        assert_eq!(restored.entries.len(), 7);
        assert_eq!(restored.entries[0], paths[11].canonicalize().unwrap());
        let on_disk: Vec<PathBuf> = serde_json::from_slice(&fs::read(file).unwrap()).unwrap();
        assert_eq!(on_disk, restored.entries);
    }

    #[test]
    fn malformed_history_and_failed_persistence_are_recoverable() {
        let fixture = Fixture::new();
        let file = fixture.0.join("recent.json");
        fs::write(&file, b"invalid JSON").unwrap();
        assert!(Recent::load(Some(file)).is_err());
        let path = fixture.archive("new");
        let blocked = fixture.0.join("blocked");
        fs::create_dir(&blocked).unwrap();
        let mut recent = Recent::empty(Some(blocked));
        assert!(recent.record(&path).is_err());
        assert_eq!(recent.entries.len(), 1);
    }

    #[test]
    fn worker_returns_load_errors_and_ignores_stale_results() {
        let fixture = Fixture::new();
        let (sender, receiver) = mpsc::channel();
        let mut worker = Loader::new(move |loaded| {
            let _ = sender.send(loaded);
        })
        .unwrap();
        worker.request(fixture.archive("first")).unwrap();
        let first = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(worker.is_current(&first));
        assert!(first.result.is_err());
        worker.request(fixture.archive("second")).unwrap();
        assert!(!worker.is_current(&first));
        let second = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(worker.is_current(&second));
        assert!(second.result.is_err());
    }

    #[test]
    fn worker_loads_a_real_built_project() {
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../samples/miko-qipao");
        if !sample.join("built/base.png").is_file() {
            eprintln!("Skipping background load integration: sample images are not installed");
            return;
        }
        let (sender, receiver) = mpsc::channel();
        let mut worker = Loader::new(move |loaded| {
            let _ = sender.send(loaded);
        })
        .unwrap();
        worker.request(sample.clone()).unwrap();
        let loaded = receiver.recv_timeout(Duration::from_secs(15)).unwrap();
        assert!(worker.is_current(&loaded));
        assert_eq!(loaded.path, sample.canonicalize().unwrap());
        let package = loaded.result.unwrap();
        assert!(!package.manifest.name.is_empty());
        assert!(package.textures.contains_key("base.png"));
    }
}
