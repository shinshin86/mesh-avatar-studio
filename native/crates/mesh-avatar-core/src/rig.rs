//! Typed rig data. Unknown JSON fields are ignored for forward compatibility.

use anyhow::{ensure, Context, Result};
use serde::{Deserialize, Serialize};

pub type Point = [f64; 2];
pub type Band = [f64; 2];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ellipse {
    pub cx: f64,
    pub cy: f64,
    pub rx: f64,
    pub ry: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Eye {
    pub opening: Vec<Point>,
    pub roi: Vec<Point>,
    pub x0: f64,
    pub x1: f64,
    pub top: [f64; 24],
    pub bot: [f64; 24],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Strand {
    pub name: String,
    pub nodes: Vec<Point>,
    pub sigma: f64,
    pub k: f64,
    pub max: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Accessory {
    pub name: String,
    pub pivot: Point,
    pub tip: Point,
    pub split: f64,
    pub r#box: [i64; 4],
    pub color: AccessoryColor,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessoryColor {
    pub redness: f64,
    pub min_red: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hand {
    pub outline: Vec<Point>,
    pub jaw: Vec<Point>,
    pub jaw_range: Band,
    pub background: Vec<Point>,
    pub elbow: Point,
    pub wrist: Point,
    pub knuckle: Point,
    pub contact: Point,
    pub forearm_share: f64,
    pub arm_band: Band,
    pub wrist_band: Band,
    pub hand_band: Band,
    pub finger_x_band: Band,
    pub finger_y_band: Band,
    pub pin_band: Band,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Head {
    #[serde(flatten)]
    pub ellipse: Ellipse,
    pub shift_x: f64,
    pub shift_y: f64,
    pub pivot_x: f64,
    pub pivot_y: f64,
    pub max_roll: f64,
    pub weight_band: Band,
    pub turn_band: Band,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    pub pivot_x: f64,
    pub pivot_y: f64,
    pub max_roll: f64,
    pub breath_band: Band,
    pub roll_band: Band,
    pub chest: Ellipse,
    pub shoulders: Vec<Ellipse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BandedEllipse {
    #[serde(flatten)]
    pub ellipse: Ellipse,
    pub band: Band,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    pub nose: Ellipse,
    pub mouth: Ellipse,
    pub eye_a: Ellipse,
    pub eye_b: Ellipse,
    pub ear_l: Ellipse,
    pub ear_r: Ellipse,
    pub brow: BandedEllipse,
    pub jaw: BandedEllipse,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Buns {
    pub bun_l: Option<Ellipse>,
    pub bun_r: Option<Ellipse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MouthArea {
    #[serde(flatten)]
    pub ellipse: Ellipse,
    pub angle: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mouth {
    pub cx: f64,
    pub cy: f64,
    pub angle: f64,
    pub half_len: f64,
    pub bow: f64,
    pub area: MouthArea,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FineGrid {
    pub x0: i64,
    pub x1: i64,
    pub y0: i64,
    pub y1: i64,
    pub cell: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mesh {
    pub base_cell: u32,
    pub fine: FineGrid,
    pub hand_cell: u32,
    pub tassel_cell: u32,
    pub eye_ball_cell: u32,
    pub eye_cell: u32,
    pub sprite_cell: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub pad_top: f64,
    pub pad_side: f64,
    pub gaze_center: Option<Point>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rig {
    pub version: u32,
    pub image: ImageSize,
    pub head: Head,
    pub body: Body,
    pub face: Face,
    pub buns: Option<Buns>,
    pub eyes: [Eye; 2],
    pub mouth: Mouth,
    pub cheeks: [Point; 2],
    #[serde(default)]
    pub strands: Vec<Strand>,
    #[serde(default)]
    pub accessories: Vec<Accessory>,
    pub hand: Option<Hand>,
    pub mesh: Mesh,
    pub view: View,
}

fn ellipse(e: &Ellipse) -> Result<()> {
    ensure!(e.rx > 0.0 && e.ry > 0.0, "ellipse radii must be positive");
    Ok(())
}

fn band(b: Band) -> Result<()> {
    ensure!(b[0] < b[1], "band start must be less than end");
    Ok(())
}

impl Rig {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let rig: Self = serde_json::from_slice(bytes).context("rig.json: invalid rig JSON")?;
        rig.validate().context("rig.json: invalid rig")?;
        Ok(rig)
    }

    pub fn validate(&self) -> Result<()> {
        ensure!(self.version == 1, "only rig version 1 is supported");
        ensure!(
            self.image.width > 0 && self.image.height > 0,
            "image dimensions must be positive"
        );
        ellipse(&self.head.ellipse)?;
        band(self.head.weight_band)?;
        band(self.head.turn_band)?;
        band(self.body.breath_band)?;
        band(self.body.roll_band)?;
        let f = &self.face;
        for e in [
            &self.body.chest,
            &f.nose,
            &f.mouth,
            &f.eye_a,
            &f.eye_b,
            &f.ear_l,
            &f.ear_r,
            &f.brow.ellipse,
            &f.jaw.ellipse,
            &self.mouth.area.ellipse,
        ]
        .into_iter()
        .chain(self.body.shoulders.iter())
        {
            ellipse(e)?;
        }
        band(f.brow.band)?;
        band(f.jaw.band)?;
        if let Some(buns) = &self.buns {
            for e in [&buns.bun_l, &buns.bun_r].into_iter().flatten() {
                ellipse(e)?;
            }
        }
        for (i, eye) in self.eyes.iter().enumerate() {
            ensure!(
                eye.opening.len() >= 3 && eye.roi.len() >= 3,
                "eyes[{i}]: polygons need at least three points"
            );
            ensure!(eye.x0 < eye.x1, "eyes[{i}]: x1 must exceed x0");
            ensure!(
                eye.top.iter().zip(eye.bot).all(|(&a, b)| a <= b),
                "eyes[{i}]: top must not exceed bottom curve"
            );
        }
        ensure!(self.mouth.half_len > 0.0, "mouth.halfLen must be positive");
        for s in &self.strands {
            ensure!(!s.name.trim().is_empty(), "strand name must not be empty");
            ensure!(
                s.nodes.len() >= 2 && s.nodes.windows(2).all(|p| p[0] != p[1]),
                "strand needs distinct consecutive nodes"
            );
            ensure!(
                s.sigma > 0.0 && s.k > 0.0 && s.max > 0.0,
                "strand sigma/k/max must be positive"
            );
        }
        for a in &self.accessories {
            ensure!(
                !a.name.trim().is_empty(),
                "accessory name must not be empty"
            );
            ensure!(
                a.split > 0.0 && a.split < 1.0,
                "accessory split must be between zero and one"
            );
            ensure!(a.pivot != a.tip, "accessory tip must differ from pivot");
            let [x0, y0, x1, y1] = a.r#box;
            ensure!(
                x0 >= 0
                    && y0 >= 0
                    && x0 < x1
                    && y0 < y1
                    && x1 <= self.image.width as i64
                    && y1 <= self.image.height as i64,
                "accessory rectangle must stay inside image"
            );
            ensure!(
                (0.0..=1.0).contains(&a.color.redness),
                "accessory redness must be between zero and one"
            );
        }
        if let Some(h) = &self.hand {
            ensure!(
                h.outline.len() >= 3 && h.background.len() >= 3 && h.jaw.len() >= 2,
                "invalid hand polygons or jaw"
            );
            ensure!(
                (0.0..=1.0).contains(&h.forearm_share),
                "hand forearmShare must be between zero and one"
            );
            for b in [
                h.jaw_range,
                h.arm_band,
                h.wrist_band,
                h.hand_band,
                h.finger_x_band,
                h.finger_y_band,
                h.pin_band,
            ] {
                band(b)?;
            }
        }
        let m = &self.mesh;
        ensure!(
            [
                m.base_cell,
                m.fine.cell,
                m.hand_cell,
                m.tassel_cell,
                m.eye_ball_cell,
                m.eye_cell,
                m.sprite_cell
            ]
            .iter()
            .all(|&n| n > 0),
            "mesh cells must be positive"
        );
        ensure!(
            m.fine.x0 < m.fine.x1 && m.fine.y0 < m.fine.y1,
            "fine rectangle must have positive area"
        );
        ensure!(
            self.view.pad_top > -1.0 && self.view.pad_top < 1.0 && self.view.pad_side > -0.5,
            "view margins must leave a positive viewport"
        );
        Ok(())
    }
}
