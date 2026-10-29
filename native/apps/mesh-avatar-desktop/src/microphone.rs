//! Microphone control runs outside the render and real-time callback threads.
use crate::audio_level::{InputLevel, LevelMapper, Sensitivity};
use anyhow::{Context, Result};
use std::sync::atomic::{AtomicU64, Ordering};
use std::{
    sync::{mpsc, Arc},
    time::Instant,
};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InputDevice {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct State {
    pub enabled: bool,
    pub starting: bool,
    pub devices: Vec<InputDevice>,
    pub selected: Option<String>,
    pub sensitivity: Sensitivity,
    pub status: String,
}
impl Default for State {
    fn default() -> Self {
        Self {
            enabled: false,
            starting: false,
            devices: vec![],
            selected: None,
            sensitivity: Sensitivity::Normal,
            status: "Off".into(),
        }
    }
}
pub enum Event {
    Devices(Vec<InputDevice>),
    Started {
        generation: u64,
        name: String,
        input: Arc<InputLevel>,
    },
    Stopped {
        generation: u64,
        error: Option<String>,
    },
    Fatal(String),
}
enum Request {
    Start(u64, Option<String>),
    Stop(u64),
    Refresh,
}
pub struct Microphone {
    requests: mpsc::Sender<Request>,
    pub state: State,
    generation: u64,
    generation_signal: Arc<AtomicU64>,
    input: Option<Arc<InputLevel>>,
    mapper: LevelMapper,
    last_tick: Instant,
    dirty: bool,
}
impl Microphone {
    pub fn new(notify: impl Fn(Event) + Send + 'static) -> Result<Self> {
        let (requests, receiver) = mpsc::channel();
        let generation_signal = Arc::new(AtomicU64::new(0));
        let worker_generation = generation_signal.clone();
        std::thread::Builder::new()
            .name("microphone control".into())
            .spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    backend::run(receiver, &notify, &worker_generation)
                }));
                if result.is_err() {
                    notify(Event::Fatal(
                        "Microphone backend stopped unexpectedly".into(),
                    ));
                }
            })?;
        Ok(Self {
            requests,
            state: State::default(),
            generation: 0,
            generation_signal,
            input: None,
            mapper: LevelMapper::default(),
            last_tick: Instant::now(),
            dirty: true,
        })
    }
    pub fn set_enabled(&mut self, enabled: bool) {
        self.generation = self.generation.wrapping_add(1);
        self.generation_signal
            .store(self.generation, Ordering::Release);
        self.input = None;
        self.mapper = LevelMapper::default();
        self.state.enabled = enabled;
        self.state.starting = enabled;
        self.state.status = if enabled { "Starting…" } else { "Off" }.into();
        let request = if enabled {
            Request::Start(self.generation, self.state.selected.clone())
        } else {
            Request::Stop(self.generation)
        };
        if self.requests.send(request).is_err() {
            self.fail("Microphone control is unavailable".into());
        }
        self.dirty = true;
    }
    pub fn select(&mut self, device: Option<String>) {
        if self.state.selected == device {
            self.dirty = true;
            return;
        }
        self.state.selected = device;
        self.dirty = true;
        if self.state.enabled {
            self.set_enabled(true);
        }
    }
    pub fn sensitivity(&mut self, sensitivity: Sensitivity) {
        self.state.sensitivity = sensitivity;
        self.dirty = true;
    }
    pub fn refresh(&mut self) {
        if self.requests.send(Request::Refresh).is_err() {
            self.fail("Microphone control is unavailable".into());
        }
    }
    fn fail(&mut self, message: String) {
        eprintln!("Microphone off: {message}");
        self.state.enabled = false;
        self.state.starting = false;
        self.state.status = format!("Off: {message}");
        self.input = None;
        self.mapper = LevelMapper::default();
        self.dirty = true;
    }
    pub fn event(&mut self, event: Event) {
        match event {
            Event::Devices(devices) => {
                if devices != self.state.devices {
                    self.state.devices = devices;
                    self.dirty = true;
                }
            }
            Event::Started {
                generation,
                name,
                input,
            } if generation == self.generation && self.state.enabled => {
                self.input = Some(input);
                self.state.starting = false;
                self.state.status = format!("On: {name}");
                self.dirty = true;
            }
            Event::Stopped { generation, error } if generation == self.generation => {
                if let Some(message) = error {
                    self.fail(message);
                } else {
                    self.state.enabled = false;
                    self.state.starting = false;
                    self.state.status = "Off".into();
                    self.input = None;
                    self.dirty = true;
                }
            }
            Event::Fatal(message) => self.fail(message),
            _ => {}
        }
    }
    pub fn take_state(&mut self) -> Option<State> {
        std::mem::take(&mut self.dirty).then(|| self.state.clone())
    }
    pub fn level(&mut self, now: Instant) -> (f64, bool) {
        let dt = now.saturating_duration_since(self.last_tick).as_secs_f64();
        self.last_tick = now;
        match &self.input {
            Some(input) if self.state.enabled => {
                self.mapper
                    .update(input.read().1, dt, self.state.sensitivity)
            }
            _ => (0.0, false),
        }
    }
}

#[cfg(target_os = "macos")]
mod backend {
    use super::*;
    use crate::audio_level::{rms, InputHealth};
    use cpal::{
        traits::{DeviceTrait, HostTrait, StreamTrait},
        FromSample, SampleFormat, SizedSample,
    };
    use std::{sync::atomic::Ordering, time::Duration};

    fn devices(host: &cpal::Host) -> Result<Vec<InputDevice>> {
        Ok(host
            .input_devices()?
            .filter_map(|device| {
                Some(InputDevice {
                    id: device.id().ok()?.to_string(),
                    name: device.to_string(),
                })
            })
            .collect())
    }
    fn typed_stream<T: SizedSample>(
        device: &cpal::Device,
        config: cpal::StreamConfig,
        input: Arc<InputLevel>,
    ) -> Result<cpal::Stream>
    where
        f32: FromSample<T>,
    {
        let failed = input.clone();
        Ok(device.build_input_stream(
            config,
            move |data: &[T], _| {
                if !data.is_empty() {
                    input.publish(rms(data.iter().map(|sample| sample.to_sample::<f32>())));
                }
            },
            move |_| {
                failed.failed.store(true, Ordering::Release);
            },
            None,
        )?)
    }
    fn start(
        host: &cpal::Host,
        selected: Option<&str>,
        input: Arc<InputLevel>,
        generation: u64,
        latest: &AtomicU64,
    ) -> Result<(cpal::Stream, String, String)> {
        let device = if let Some(id) = selected {
            host.device_by_id(&id.parse()?)
        } else {
            host.default_input_device()
        }
        .context("No selected microphone is available")?;
        let config = device.default_input_config()?;
        let format = config.sample_format();
        let config = config.config();
        macro_rules! stream {
            ($ty:ty) => {
                typed_stream::<$ty>(&device, config, input)
            };
        }
        let stream = match format {
            SampleFormat::F32 => stream!(f32),
            SampleFormat::F64 => stream!(f64),
            SampleFormat::I8 => stream!(i8),
            SampleFormat::I16 => stream!(i16),
            SampleFormat::I24 => stream!(cpal::I24),
            SampleFormat::I32 => stream!(i32),
            SampleFormat::I64 => stream!(i64),
            SampleFormat::U8 => stream!(u8),
            SampleFormat::U16 => stream!(u16),
            SampleFormat::U24 => stream!(cpal::U24),
            SampleFormat::U32 => stream!(u32),
            SampleFormat::U64 => stream!(u64),
            _ => anyhow::bail!("Unsupported microphone sample format: {format}"),
        }?;
        // A permission prompt may have outlived a subsequent Off or device selection.
        anyhow::ensure!(
            latest.load(Ordering::Acquire) == generation,
            "Microphone request cancelled"
        );
        stream.play()?;
        anyhow::ensure!(
            latest.load(Ordering::Acquire) == generation,
            "Microphone request cancelled"
        );
        Ok((stream, device.id()?.to_string(), device.to_string()))
    }
    struct Active {
        _stream: cpal::Stream,
        id: String,
        generation: u64,
        input: Arc<InputLevel>,
        health: InputHealth,
    }
    pub fn run(receiver: mpsc::Receiver<Request>, notify: &impl Fn(Event), latest: &AtomicU64) {
        let host = cpal::default_host();
        let mut active: Option<Active> = None;
        let mut next_devices = Instant::now();
        loop {
            match receiver.recv_timeout(Duration::from_millis(25)) {
                Ok(Request::Start(generation, selected)) => {
                    if latest.load(Ordering::Acquire) != generation {
                        continue;
                    }
                    active = None;
                    let input = Arc::new(InputLevel::default());
                    match start(
                        &host,
                        selected.as_deref(),
                        input.clone(),
                        generation,
                        latest,
                    ) {
                        Ok((stream, id, name)) => {
                            active = Some(Active {
                                _stream: stream,
                                id,
                                generation,
                                input: input.clone(),
                                health: InputHealth::new(Instant::now()),
                            });
                            notify(Event::Started {
                                generation,
                                name,
                                input,
                            });
                        }
                        Err(error) => notify(Event::Stopped {
                            generation,
                            error: Some(format!("{error:#}")),
                        }),
                    }
                }
                Ok(Request::Stop(generation)) => {
                    active = None;
                    notify(Event::Stopped {
                        generation,
                        error: None,
                    });
                }
                Ok(Request::Refresh) => next_devices = Instant::now(),
                Err(mpsc::RecvTimeoutError::Disconnected) => return,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            let now = Instant::now();
            let mut failure = None;
            if let Some(stream) = &mut active {
                failure = stream
                    .health
                    .failure(&stream.input, now, true)
                    .map(str::to_string);
            }
            if now >= next_devices {
                match devices(&host) {
                    Ok(devices) => {
                        if active
                            .as_ref()
                            .is_some_and(|s| !devices.iter().any(|d| d.id == s.id))
                        {
                            failure = Some("Input device disconnected".into());
                        }
                        notify(Event::Devices(devices));
                    }
                    Err(error) => {
                        if active.is_some() {
                            failure = Some(format!("Input devices unavailable: {error}"));
                        }
                    }
                }
                next_devices = now + Duration::from_secs(if active.is_some() { 1 } else { 5 });
            }
            if let Some(error) = failure {
                if let Some(stream) = active.take() {
                    let generation = stream.generation;
                    drop(stream);
                    notify(Event::Stopped {
                        generation,
                        error: Some(error),
                    });
                }
            }
        }
    }
}
#[cfg(not(target_os = "macos"))]
mod backend {
    use super::*;
    pub fn run(receiver: mpsc::Receiver<Request>, notify: &impl Fn(Event), _: &AtomicU64) {
        for request in receiver {
            if let Request::Start(generation, _) = request {
                notify(Event::Stopped {
                    generation,
                    error: Some("Microphone input is currently macOS-only".into()),
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_is_off_stale_start_cannot_enable_after_stop_and_errors_clear_level() {
        // Synthetic transport: this test never creates a host, stream or permission prompt.
        let (requests, _receiver) = mpsc::channel();
        let mut mic = Microphone {
            requests,
            state: State::default(),
            generation: 0,
            generation_signal: Arc::new(AtomicU64::new(0)),
            input: None,
            mapper: LevelMapper::default(),
            last_tick: Instant::now(),
            dirty: true,
        };
        assert!(!mic.state.enabled);
        mic.set_enabled(true);
        let generation = mic.generation;
        mic.set_enabled(false);
        mic.event(Event::Started {
            generation,
            name: "stale".into(),
            input: Arc::new(InputLevel::default()),
        });
        assert!(!mic.state.enabled && mic.input.is_none());
        mic.set_enabled(true);
        let input = Arc::new(InputLevel::default());
        input.publish(0.5);
        mic.event(Event::Started {
            generation: mic.generation,
            name: "synthetic".into(),
            input,
        });
        assert!(
            mic.level(Instant::now() + std::time::Duration::from_millis(50))
                .1
        );
        mic.event(Event::Stopped {
            generation,
            error: Some("stale stream error".into()),
        });
        assert!(mic.state.enabled);
        mic.event(Event::Stopped {
            generation: mic.generation,
            error: Some("unplugged".into()),
        });
        assert!(!mic.state.enabled);
        assert_eq!(mic.level(Instant::now()), (0.0, false));
        assert!(mic.state.status.contains("unplugged"));
    }
}
