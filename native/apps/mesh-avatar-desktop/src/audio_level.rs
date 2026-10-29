//! Allocation-free buffer reduction and a lock-free latest-value handoff.
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub fn rms(samples: impl IntoIterator<Item = f32>) -> f32 {
    let mut power = 0.0_f64;
    let mut count = 0_u64;
    for sample in samples {
        let value = if sample.is_finite() {
            sample.clamp(-1.0, 1.0)
        } else {
            0.0
        };
        power += f64::from(value).powi(2);
        count += 1;
    }
    if count == 0 {
        0.0
    } else {
        (power / count as f64).sqrt() as f32
    }
}

#[derive(Default)]
pub struct InputLevel {
    level: AtomicU32,
    sequence: AtomicU64,
    pub failed: AtomicBool,
}
impl InputLevel {
    pub fn publish(&self, value: f32) {
        self.level.store(value.to_bits(), Ordering::Relaxed);
        self.sequence.fetch_add(1, Ordering::Release);
    }
    pub fn read(&self) -> (u64, f32) {
        let sequence = self.sequence.load(Ordering::Acquire);
        (sequence, f32::from_bits(self.level.load(Ordering::Relaxed)))
    }
}

pub struct InputHealth {
    sequence: u64,
    last_sample: Instant,
}
impl InputHealth {
    pub fn new(now: Instant) -> Self {
        Self {
            sequence: 0,
            last_sample: now,
        }
    }
    pub fn failure(
        &mut self,
        input: &InputLevel,
        now: Instant,
        connected: bool,
    ) -> Option<&'static str> {
        let sequence = input.read().0;
        if sequence != self.sequence {
            self.sequence = sequence;
            self.last_sample = now;
        }
        if !connected {
            Some("Input device disconnected")
        } else if input.failed.load(Ordering::Acquire) {
            Some("Input stream failed or device disconnected")
        } else if now.saturating_duration_since(self.last_sample) > Duration::from_secs(2) {
            Some("No microphone samples received")
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Sensitivity {
    Low,
    #[default]
    Normal,
    High,
}
impl Sensitivity {
    pub const ALL: [Self; 3] = [Self::Low, Self::Normal, Self::High];
    pub fn name(self) -> &'static str {
        match self {
            Self::Low => "Low",
            Self::Normal => "Normal",
            Self::High => "High",
        }
    }
    fn db(self) -> f64 {
        match self {
            Self::Low => -6.0,
            Self::Normal => 0.0,
            Self::High => 12.0,
        }
    }
}
#[derive(Default)]
pub struct LevelMapper {
    level: f64,
    gate: bool,
    speaking: bool,
    hold: f64,
}
impl LevelMapper {
    pub fn update(&mut self, rms: f32, dt: f64, sensitivity: Sensitivity) -> (f64, bool) {
        let dt = if dt.is_finite() {
            dt.clamp(0.0, 0.1)
        } else {
            0.0
        };
        let rms = if rms.is_finite() {
            f64::from(rms.clamp(0.0, 1.0))
        } else {
            0.0
        };
        let db = 20.0 * rms.max(1e-6).log10() + sensitivity.db();
        if db >= -48.0 {
            self.gate = true;
        } else if db < -54.0 {
            self.gate = false;
        }
        let target = if self.gate {
            ((db + 54.0) / 39.0).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let tau = if target > self.level { 0.025 } else { 0.1 };
        self.level += (target - self.level) * (1.0 - (-dt / tau).exp());
        if target >= 0.15 || (self.speaking && target >= 0.07) {
            self.speaking = true;
            self.hold = 0.18;
        } else {
            self.hold = (self.hold - dt).max(0.0);
            if self.hold <= 1e-9 {
                self.speaking = false;
            }
        }
        (self.level.clamp(0.0, 1.0), self.speaking)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silence_sine_antiphase_stereo_and_invalid_samples() {
        assert_eq!(rms([]), 0.0);
        assert_eq!(rms([0.0; 128]), 0.0);
        let sine = (0..480).map(|i| (std::f32::consts::TAU * i as f32 / 48.0).sin() * 0.5);
        assert!((rms(sine) - 0.5 / std::f32::consts::SQRT_2).abs() < 1e-6);
        assert!((rms([0.5, -0.5, 0.5, -0.5]) - 0.5).abs() < 1e-6);
        assert_eq!(rms([f32::NAN, f32::INFINITY]), 0.0);
        assert_eq!(rms([2.0, -2.0]), 1.0);
    }
    #[test]
    fn gate_smoothing_sensitivity_and_speaking_release() {
        let mut mapper = LevelMapper::default();
        for _ in 0..100 {
            assert_eq!(
                mapper.update(0.001, 0.01, Sensitivity::Normal),
                (0.0, false)
            );
        }
        let first = mapper.update(0.1, 0.01, Sensitivity::Normal);
        assert!(first.1 && first.0 > 0.0 && first.0 < 0.5);
        for _ in 0..20 {
            mapper.update(0.1, 0.01, Sensitivity::Normal);
        }
        assert!(mapper.level > first.0);
        for _ in 0..12 {
            assert!(mapper.update(0.0, 0.01, Sensitivity::Normal).1);
        }
        for _ in 0..10 {
            mapper.update(0.0, 0.01, Sensitivity::Normal);
        }
        assert!(!mapper.speaking);
        for _ in 0..100 {
            mapper.update(0.0, 0.01, Sensitivity::Normal);
        }
        assert!(mapper.level < 1e-5);
        let mut normal = LevelMapper::default();
        let mut high = LevelMapper::default();
        assert_eq!(normal.update(0.003, 0.1, Sensitivity::Normal), (0.0, false));
        assert!(high.update(0.003, 0.1, Sensitivity::High).1);
    }
    #[test]
    fn bounded_mapping_and_gate_hysteresis() {
        let mut mapper = LevelMapper::default();
        let db = |db: f32| 10_f32.powf(db / 20.0);
        assert_eq!(mapper.update(db(-51.0), 0.05, Sensitivity::Normal).0, 0.0);
        mapper.update(db(-47.0), 0.05, Sensitivity::Normal);
        assert!(mapper.gate);
        mapper.update(db(-51.0), 0.05, Sensitivity::Normal);
        assert!(mapper.gate);
        mapper.update(db(-55.0), 0.05, Sensitivity::Normal);
        assert!(!mapper.gate);
        for value in [f32::NAN, f32::INFINITY, -1.0, 0.0, 1.0, 100.0] {
            let (level, _) = mapper.update(value, 0.05, Sensitivity::High);
            assert!(level.is_finite() && (0.0..=1.0).contains(&level));
        }
    }
    #[test]
    fn silent_callbacks_are_live_and_old_stream_errors_are_isolated() {
        let old = InputLevel::default();
        let new = InputLevel::default();
        for _ in 0..100 {
            new.publish(rms([0.0; 64]));
        }
        assert_eq!(new.read(), (100, 0.0));
        old.failed.store(true, Ordering::Release);
        assert!(!new.failed.load(Ordering::Acquire));
    }
    #[test]
    fn stalled_callbacks_errors_and_device_removal_are_detected_without_hardware() {
        let input = InputLevel::default();
        let now = Instant::now();
        let mut health = InputHealth::new(now);
        assert!(health.failure(&input, now, true).is_none());
        assert_eq!(
            health.failure(&input, now + Duration::from_secs(3), true),
            Some("No microphone samples received")
        );
        input.publish(0.0);
        assert!(health
            .failure(&input, now + Duration::from_secs(4), true)
            .is_none());
        assert_eq!(
            health.failure(&input, now + Duration::from_secs(4), false),
            Some("Input device disconnected")
        );
        input.failed.store(true, Ordering::Release);
        assert!(health
            .failure(&input, now + Duration::from_secs(4), true)
            .unwrap()
            .contains("stream failed"));
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn pcm_signed_full_scale_and_unsigned_silence_are_normalized() {
        use cpal::Sample;
        assert!((rms([i16::MIN, i16::MAX].map(|v| v.to_sample::<f32>())) - 1.0).abs() < 0.0001);
        assert_eq!(rms([32768_u16; 16].map(|v| v.to_sample::<f32>())), 0.0);
    }
}
