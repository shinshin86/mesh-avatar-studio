//! Numeric input and render-size guards, independent of a window or GPU.
use anyhow::{ensure, Result};
use winit::{
    dpi::{LogicalSize, PhysicalSize},
    event::MouseScrollDelta,
};

pub struct ScaleBounds {
    pub dpi: f64,
    pub screen: Option<LogicalSize<f64>>,
    pub texture_limit: u32,
}

#[derive(Clone)]
pub struct Scaling {
    base: LogicalSize<f64>,
    zoom: f64,
    pending: Option<PhysicalSize<u32>>,
}

impl Scaling {
    pub fn new(base: LogicalSize<f64>) -> Result<Self> {
        ensure!(
            [base.width, base.height]
                .iter()
                .all(|v| v.is_finite() && *v > 0.0),
            "invalid logical window dimensions"
        );
        Ok(Self {
            base,
            zoom: 1.0,
            pending: None,
        })
    }

    pub fn scroll(&mut self, delta: MouseScrollDelta, bounds: ScaleBounds) {
        let amount = match delta {
            MouseScrollDelta::LineDelta(_, y) => f64::from(y) * 0.08,
            MouseScrollDelta::PixelDelta(p) => p.y / bounds.dpi * 0.0025,
        };
        self.change(amount, bounds);
    }

    pub fn keyboard(&mut self, increase: bool, bounds: ScaleBounds) {
        self.change(
            if increase {
                1.1_f64.ln()
            } else {
                -1.1_f64.ln()
            },
            bounds,
        );
    }

    /// Also reapply bounds when moving between monitors with different pixel ratios.
    pub fn refresh(&mut self, bounds: ScaleBounds) {
        self.change(0.0, bounds);
    }

    pub fn zoom(&self) -> f64 {
        self.zoom
    }
    pub fn logical_size(&self) -> LogicalSize<f64> {
        LogicalSize::new(self.base.width * self.zoom, self.base.height * self.zoom)
    }
    pub fn has_request(&self) -> bool {
        self.pending.is_some()
    }
    pub fn from_zoom(base: LogicalSize<f64>, zoom: f64, bounds: ScaleBounds) -> Result<Self> {
        ensure!(zoom.is_finite() && zoom > 0.0, "invalid saved zoom");
        let mut scaling = Self::new(base)?;
        scaling.zoom = zoom;
        scaling.refresh(bounds);
        ensure!(scaling.pending.is_some(), "invalid monitor bounds");
        Ok(scaling)
    }

    /// Prepare a different avatar's aspect without changing the live scaling state.
    pub fn rebase(&self, base: LogicalSize<f64>, bounds: ScaleBounds) -> Result<Self> {
        let mut replacement = Self::new(base)?;
        replacement.zoom = self.zoom;
        replacement.refresh(bounds);
        ensure!(replacement.pending.is_some(), "invalid scale bounds");
        Ok(replacement)
    }

    fn change(&mut self, amount: f64, bounds: ScaleBounds) {
        if !amount.is_finite()
            || !bounds.dpi.is_finite()
            || bounds.dpi <= 0.0
            || bounds.texture_limit == 0
        {
            return;
        }
        let physical_base = [self.base.width * bounds.dpi, self.base.height * bounds.dpi];
        if physical_base.iter().any(|v| !v.is_finite() || *v <= 0.0) {
            return;
        }
        let mut upper = 4.0_f64;
        for side in physical_base {
            upper = upper.min(f64::from(bounds.texture_limit) / side);
        }
        if let Some(screen) = bounds.screen {
            for (side, base) in [
                (screen.width, self.base.width),
                (screen.height, self.base.height),
            ] {
                if side.is_finite() && side > 0.0 {
                    upper = upper.min(side * 0.9 / base);
                }
            }
        }
        if !upper.is_finite() || upper <= 0.0 {
            return;
        }
        // A small monitor or very large pixel ratio can lower the usual minimum.
        self.zoom = (self.zoom * amount.clamp(-0.5, 0.5).exp()).clamp(0.4_f64.min(upper), upper);
        let physical = physical_base.map(|v| {
            (v * self.zoom)
                .round()
                .clamp(1.0, f64::from(bounds.texture_limit)) as u32
        });
        self.pending = Some(PhysicalSize::new(physical[0], physical[1]));
    }

    /// Coalesce an input burst into a single native resize outside its callbacks.
    pub fn take_request(&mut self) -> Option<PhysicalSize<u32>> {
        self.pending.take()
    }
}

/// AppKit can request a draw before delivering its queued Resized notification.
/// Using the new window size with the old surface would mismatch MSAA attachments.
pub fn render_size(
    configured: PhysicalSize<u32>,
    actual: PhysicalSize<u32>,
    limit: u32,
) -> Option<[u32; 2]> {
    (configured == actual
        && actual.width > 0
        && actual.height > 0
        && actual.width <= limit
        && actual.height <= limit)
        .then_some([actual.width, actual.height])
}

#[cfg(test)]
mod tests {
    use super::*;
    use winit::dpi::PhysicalPosition;

    fn bounds(dpi: f64) -> ScaleBounds {
        ScaleBounds {
            dpi,
            screen: Some(LogicalSize::new(1920.0, 1080.0)),
            texture_limit: 8192,
        }
    }
    fn scale() -> Scaling {
        Scaling::new(LogicalSize::new(400.0, 372.0)).unwrap()
    }

    #[test]
    fn line_and_trackpad_inputs_have_consistent_hidpi_units() {
        for dpi in [1.0, 1.25, 2.0, 3.0, 4.0] {
            let mut line = scale();
            let mut pixel = scale();
            line.scroll(MouseScrollDelta::LineDelta(0.0, 1.0), bounds(dpi));
            pixel.scroll(
                MouseScrollDelta::PixelDelta(PhysicalPosition::new(0.0, 32.0 * dpi)),
                bounds(dpi),
            );
            assert_eq!(line.take_request(), pixel.take_request());
        }
    }

    #[test]
    fn bursts_extremes_and_direction_changes_stay_bounded() {
        for dpi in [1.0, 1.25, 2.0, 4.0, 8.0, 1000.0] {
            let mut scale = scale();
            for i in 0..4000 {
                let delta = [0.0, 0.001, -0.001, 1.0, -1.0, f64::MAX, -f64::MAX][i % 7];
                scale.scroll(
                    MouseScrollDelta::PixelDelta(PhysicalPosition::new(0.0, delta)),
                    bounds(dpi),
                );
                if i % 3 == 0 {
                    scale.keyboard(i % 2 == 0, bounds(dpi));
                }
                let size = scale.take_request().unwrap();
                assert!(size.width > 0 && size.height > 0);
                assert!(size.width <= 8192 && size.height <= 8192);
                // Physical rounding can change the logical aspect by at most one pixel.
                assert!((f64::from(size.height) - f64::from(size.width) * 0.93).abs() <= 1.0);
                assert!(f64::from(size.width) / dpi <= 1920.0 * 0.9 + 1.0);
                assert!(f64::from(size.height) / dpi <= 1080.0 * 0.9 + 1.0);
            }
        }
    }

    #[test]
    fn malformed_inputs_and_bounds_do_not_poison_subsequent_input() {
        let mut scale = scale();
        for value in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            scale.scroll(
                MouseScrollDelta::PixelDelta(PhysicalPosition::new(0.0, value)),
                bounds(2.0),
            );
            assert!(scale.take_request().is_none());
        }
        for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            scale.scroll(MouseScrollDelta::LineDelta(0.0, value), bounds(2.0));
            assert!(scale.take_request().is_none());
        }
        for dpi in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::MAX] {
            scale.keyboard(true, bounds(dpi));
            assert!(scale.take_request().is_none());
        }
        scale.keyboard(true, bounds(2.0));
        assert_eq!(scale.take_request(), Some(PhysicalSize::new(880, 818)));
        let mut invalid = bounds(2.0);
        invalid.texture_limit = 0;
        scale.keyboard(true, invalid);
        assert!(scale.take_request().is_none());
    }

    #[test]
    fn command_keys_share_limits_and_requests_are_coalesced() {
        let mut scale = scale();
        for _ in 0..1000 {
            scale.keyboard(false, bounds(2.0));
        }
        assert_eq!(scale.take_request(), Some(PhysicalSize::new(320, 298)));
        assert!(scale.take_request().is_none());
        for _ in 0..1000 {
            scale.keyboard(true, bounds(2.0));
        }
        let max = scale.take_request().unwrap();
        assert!(max.height <= 1944);
        scale.keyboard(false, bounds(2.0));
        assert!(scale.take_request().unwrap().height < max.height);
    }

    #[test]
    fn moving_to_higher_dpi_respects_device_limits() {
        let mut scale = scale();
        for _ in 0..100 {
            scale.keyboard(true, bounds(1.0));
        }
        scale.take_request();
        scale.refresh(ScaleBounds {
            dpi: 4.0,
            screen: None,
            texture_limit: 1024,
        });
        let size = scale.take_request().unwrap();
        assert_eq!(size.width, 1024);
        assert_eq!(size.height, 952);
    }

    #[test]
    fn queued_resize_never_renders_mismatched_attachments() {
        let old = PhysicalSize::new(800, 744);
        let new = PhysicalSize::new(880, 818);
        assert_eq!(render_size(old, old, 8192), Some([800, 744]));
        // Native drawRect arrives before the queued resize has configured the surface.
        assert_eq!(render_size(old, new, 8192), None);
        assert_eq!(render_size(new, new, 8192), Some([880, 818]));
        for bad in [
            PhysicalSize::new(0, 744),
            PhysicalSize::new(800, 0),
            PhysicalSize::new(9000, 8000),
        ] {
            assert_eq!(render_size(bad, bad, 8192), None);
        }
    }
}
