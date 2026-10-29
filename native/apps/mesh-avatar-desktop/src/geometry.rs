//! Prepare a replacement viewport without moving or mutating the live window.
use crate::scaling::{ScaleBounds, Scaling};
use anyhow::Result;
use mesh_avatar_wgpu::ViewOptions;
use winit::dpi::{LogicalSize, PhysicalPosition};

pub fn base_size(view: &ViewOptions) -> LogicalSize<f64> {
    LogicalSize::new(
        400.0,
        400.0 * f64::from(view.image_size[1]) * (1.0 + view.pad_top)
            / (f64::from(view.image_size[0]) * (1.0 + 2.0 * view.pad_side)),
    )
}

pub fn fit_base(view: &ViewOptions, screen: Option<LogicalSize<f64>>) -> Result<LogicalSize<f64>> {
    view.transform([1, 1])?;
    let mut base = base_size(view);
    Scaling::new(base)?;
    if let Some(screen) = screen {
        let fit = (screen.width * 0.85 / base.width)
            .min(screen.height * 0.85 / base.height)
            .min(1.0);
        base.width *= fit;
        base.height *= fit;
    }
    Scaling::new(base)?;
    Ok(base)
}

pub struct SwitchLayout {
    pub scaling: Scaling,
    pub position: PhysicalPosition<i32>,
}
pub fn switch_layout(
    view: &ViewOptions,
    current: &Scaling,
    bounds: ScaleBounds,
    position: PhysicalPosition<i32>,
) -> Result<SwitchLayout> {
    let base = fit_base(view, bounds.screen)?;
    Ok(SwitchLayout {
        scaling: current.rebase(base, bounds)?,
        position,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use mesh_avatar_wgpu::Fit;
    use winit::dpi::PhysicalSize;
    fn bounds() -> ScaleBounds {
        ScaleBounds {
            dpi: 2.0,
            screen: None,
            texture_limit: 8192,
        }
    }
    #[test]
    fn switching_aspect_preserves_zoom_top_left_and_padding() {
        let mut current = Scaling::new(LogicalSize::new(400.0, 372.0)).unwrap();
        current.keyboard(true, bounds());
        current.take_request();
        let view = ViewOptions {
            image_size: [1000, 500],
            pad_top: -0.1,
            pad_side: 0.1,
            fit: Fit::Contain,
        };
        let position = PhysicalPosition::new(-1200, 140);
        let mut layout = switch_layout(&view, &current, bounds(), position).unwrap();
        assert_eq!(layout.position, position);
        assert_eq!(
            layout.scaling.take_request(),
            Some(PhysicalSize::new(880, 330))
        );
        assert!(current.take_request().is_none());
    }
    #[test]
    fn extreme_aspect_is_fitted_and_bad_rig_leaves_current_layout_intact() {
        let current = Scaling::new(LogicalSize::new(400.0, 372.0)).unwrap();
        let mut view = ViewOptions {
            image_size: [100, 10000],
            pad_top: 0.0,
            pad_side: 0.0,
            fit: Fit::Contain,
        };
        let limits = ScaleBounds {
            dpi: 2.0,
            screen: Some(LogicalSize::new(1200.0, 800.0)),
            texture_limit: 8192,
        };
        let mut layout =
            switch_layout(&view, &current, limits, PhysicalPosition::new(0, 0)).unwrap();
        assert_eq!(
            layout.scaling.take_request(),
            Some(PhysicalSize::new(14, 1360))
        );
        view.pad_top = -1.0;
        assert!(switch_layout(&view, &current, bounds(), PhysicalPosition::new(0, 0)).is_err());
    }
}
