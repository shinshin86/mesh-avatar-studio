use super::{motion::expression_target, rig::Parameters};
use std::collections::BTreeMap;

pub const OVERLAY_EXPRESSIONS: &[(&str, &str)] = &[
    ("neutral", "normal"),
    ("smile", "smile"),
    ("shy", "shy"),
    ("surprise", "surprise"),
    ("halfLidded", "jito"),
    ("angry", "angryTalk"),
    ("sad", "sadTalk"),
    ("wink", "wink"),
];
pub fn overlay_target(name: &str) -> BTreeMap<String, f64> {
    let expr = OVERLAY_EXPRESSIONS
        .iter()
        .find(|(n, _)| *n == name)
        .map_or("normal", |(_, e)| *e);
    let mut target = expression_target(expr);
    target.remove("mouthForm");
    target.insert("pitch".into(), if name == "sad" { -6.0 } else { 0.0 });
    if name == "sad" {
        target.insert("gy".into(), -0.45);
    }
    target
}
pub fn apply_overlay(p: &Parameters, m: &BTreeMap<String, f64>) -> Parameters {
    let mut out = p.clone();
    out.eye_r_open = p.eye_r_open * m["eyeOpen"];
    out.eye_l_open = p.eye_l_open * m["eyeOpenL"];
    out.eye_smile = p.eye_smile.max(m["eyeSmile"]);
    out.eye_smile_l = Some(p.eye_smile_l.unwrap_or(p.eye_smile).max(m["eyeSmileL"]));
    out.blush = p.blush.max(m["blush"]);
    out.brow_y = (p.brow_y + m["browY"]).clamp(-1.0, 1.0);
    out.brow_angle = (p.brow_angle + m["browAngle"]).clamp(-1.0, 1.0);
    out.mouth_open = p.mouth_open.max(m["mouthOpen"]);
    out.gaze_x = (p.gaze_x + m["gx"]).clamp(-1.0, 1.0);
    out.gaze_y = (p.gaze_y + m["gy"]).clamp(-1.0, 1.0);
    out.angle_y = (p.angle_y + m["pitch"]).clamp(-30.0, 30.0);
    out
}
pub struct ExpressionOverlay {
    pub name: String,
    mix: BTreeMap<String, f64>,
}
impl Default for ExpressionOverlay {
    fn default() -> Self {
        Self {
            name: "neutral".into(),
            mix: overlay_target("neutral"),
        }
    }
}
impl ExpressionOverlay {
    pub fn set(&mut self, name: &str) {
        self.name = if OVERLAY_EXPRESSIONS.iter().any(|(n, _)| *n == name) {
            name
        } else {
            "neutral"
        }
        .into();
    }
    pub fn active(&self) -> bool {
        self.name != "neutral"
            || overlay_target("neutral")
                .iter()
                .any(|(key, value)| (self.mix[key] - value).abs() > 1e-3)
    }
    pub fn apply(&mut self, p: &Parameters, dt: f64) -> Parameters {
        if !self.active() {
            self.mix = overlay_target("neutral");
            return p.clone();
        }
        let target = overlay_target(&self.name);
        let k = 1.0 - (-dt.max(0.0) * 12.0).exp();
        for (key, value) in target {
            let mix = self.mix.get_mut(&key).unwrap();
            *mix += (value - *mix) * k;
        }
        apply_overlay(p, &self.mix)
    }
}
