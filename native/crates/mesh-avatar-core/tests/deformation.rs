use mesh_avatar_core::{
    engine::{
        grid::build_grid,
        physics::Physics,
        rig::{eye_part_alpha, eye_part_y, EyePart, Parameters, PhysicsOffsets, RigEngine},
        sprites::{SpriteCoverage, Sprites},
    },
    format::AvatarPackage,
    rig::Point,
};
use serde::{de::DeserializeOwned, Deserialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn directory() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/conformance")
}
fn golden<T: DeserializeOwned>(name: &str) -> Option<T> {
    match fs::read(directory().join(name)) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).unwrap()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            eprintln!("{name} absent; skipping. Run node native/conformance/dump.mjs first.");
            None
        }
        Err(e) => panic!("could not read {name}: {e}"),
    }
}
fn avatar() -> AvatarPackage {
    AvatarPackage::open(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../samples/miko-qipao"))
        .unwrap()
}
fn compare(actual: f64, expected: f64, max: &mut f64) {
    assert!(
        actual.is_finite() && expected.is_finite(),
        "non-finite conformance output"
    );
    let delta = (actual - expected).abs();
    *max = max.max(delta);
    assert!(
        delta <= 1e-3,
        "actual {actual}, expected {expected}, delta {delta}"
    );
}
fn compare_point(actual: Point, expected: Point, max: &mut f64) {
    for i in 0..2 {
        compare(actual[i], expected[i], max);
    }
}

#[derive(Deserialize)]
struct Deformations {
    version: u32,
    parameters: Vec<serde_json::Value>,
    points: Vec<Point>,
    files: Vec<String>,
}
#[derive(Deserialize)]
struct EyeOutput {
    eye: usize,
    part: EyePart,
    alpha: f64,
    positions: Vec<f64>,
}
#[derive(Deserialize)]
struct Pose {
    parameters: Parameters,
    physics: PhysicsOffsets,
    base: Vec<f64>,
    hand: Vec<f64>,
    eyes: Vec<EyeOutput>,
}

#[test]
fn every_regression_point_and_eye_part_matches_fixed_and_zero_physics() {
    let Some(goldens) = golden::<Deformations>("deformation.json") else {
        return;
    };
    assert_eq!(goldens.version, 1);
    compare_json(
        &serde_json::to_value(mesh_avatar_core::engine::rig::PARAMS).unwrap(),
        &serde_json::to_value(&goldens.parameters).unwrap(),
        &mut 0.0,
    );
    assert_eq!(goldens.files.len(), 28);
    let avatar = avatar();
    let engine = RigEngine::new(&avatar.rig);
    let hair = &avatar.textures["hairmask.png"];
    let weights: Vec<_> = goldens
        .points
        .iter()
        .map(|&[x, y]| {
            let ix = (x.round() as u32).min(hair.width - 1);
            let iy = (y.round() as u32).min(hair.height - 1);
            engine.base_weights(
                x,
                y,
                hair.rgba[((iy * hair.width + ix) * 4) as usize] as f64 / 255.0,
            )
        })
        .collect();
    let hands: Vec<_> = goldens
        .points
        .iter()
        .map(|&[x, y]| engine.hand_weights(x, y))
        .collect();
    let mut max = 0.0;
    for file in &goldens.files {
        let pose: Pose = golden(file).expect("missing pose golden");
        let p = &pose.parameters;
        let frame = engine.hand_frame(p);
        assert_eq!(pose.base.len(), goldens.points.len() * 2);
        assert_eq!(pose.hand.len(), pose.base.len());
        assert_eq!(pose.eyes.len(), 8);
        for (i, &[x, y]) in goldens.points.iter().enumerate() {
            compare_point(
                engine.deform_base(x, y, &weights[i], p, &pose.physics),
                [pose.base[2 * i], pose.base[2 * i + 1]],
                &mut max,
            );
            compare_point(
                engine.deform_hand(x, y, &hands[i], p, &frame),
                [pose.hand[2 * i], pose.hand[2 * i + 1]],
                &mut max,
            );
        }
        for eye in &pose.eyes {
            let open = if eye.eye == 0 {
                p.eye_r_open
            } else {
                p.eye_l_open
            };
            compare(
                eye_part_alpha(eye.part, open, p.eye_smile),
                eye.alpha,
                &mut max,
            );
            assert_eq!(eye.positions.len(), pose.base.len());
            for (i, &[x, y]) in goldens.points.iter().enumerate() {
                let y = eye_part_y(&avatar.rig.eyes[eye.eye], eye.part, x, y, open, p.eye_smile);
                compare_point(
                    engine.deform_base(x, y, &weights[i], p, &pose.physics),
                    [eye.positions[2 * i], eye.positions[2 * i + 1]],
                    &mut max,
                );
            }
        }
    }
    eprintln!(
        "Deformation: {} poses, {} points each, max delta {max} px",
        goldens.files.len(),
        goldens.points.len()
    );
}

fn compare_json(actual: &serde_json::Value, expected: &serde_json::Value, max: &mut f64) {
    use serde_json::Value;
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            compare(a.as_f64().unwrap(), b.as_f64().unwrap(), max)
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                compare_json(a, b, max);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len());
            for (key, value) in a {
                compare_json(value, &b[key], max);
            }
        }
        _ => assert_eq!(actual, expected),
    }
}

#[derive(Deserialize)]
struct Variants {
    version: u32,
    variants: Vec<Variant>,
}
#[derive(Deserialize)]
struct Variant {
    rig: mesh_avatar_core::rig::Rig,
    weights: Vec<WeightedPoint>,
    frames: Vec<VariantFrame>,
}
#[derive(Deserialize)]
struct WeightedPoint {
    x: f64,
    y: f64,
    hair: f64,
    weights: serde_json::Value,
}
#[derive(Deserialize)]
struct VariantFrame {
    parameters: Parameters,
    dt: f64,
    out: PhysicsOffsets,
    positions: Vec<Point>,
}

#[test]
fn absent_optional_features_and_resampled_strands_match_javascript() {
    let Some(goldens) = golden::<Variants>("variants.json") else {
        return;
    };
    assert_eq!(goldens.version, 1);
    let mut max = 0.0;
    for variant in goldens.variants {
        variant.rig.validate().unwrap();
        let engine = RigEngine::new(&variant.rig);
        let mut weights = Vec::new();
        for point in &variant.weights {
            let w = engine.base_weights(point.x, point.y, point.hair);
            compare_json(&serde_json::to_value(&w).unwrap(), &point.weights, &mut max);
            weights.push(w);
        }
        let mut physics = Physics::new(&variant.rig);
        for frame in variant.frames {
            let out = physics.step(&engine, &frame.parameters, frame.dt);
            compare_json(
                &serde_json::to_value(out).unwrap(),
                &serde_json::to_value(frame.out).unwrap(),
                &mut max,
            );
            for (i, (point, weight)) in variant.weights.iter().zip(&weights).enumerate() {
                compare_point(
                    engine.deform_base(point.x, point.y, weight, &frame.parameters, out),
                    frame.positions[i],
                    &mut max,
                );
            }
        }
    }
    eprintln!("Optional features and strand resampling: max delta {max} px");
}

#[derive(Deserialize)]
struct PhysicsGoldens {
    version: u32,
    traces: Vec<Trace>,
}
#[derive(Deserialize)]
struct Trace {
    gain: f64,
    frames: Vec<PhysicsFrame>,
}
#[derive(Deserialize)]
struct PhysicsFrame {
    parameters: Parameters,
    dt: f64,
    out: PhysicsOffsets,
    chains: Vec<Chain>,
}
#[derive(Deserialize)]
struct Chain {
    name: String,
    points: [Point; 3],
    phi: Point,
    anchor: Point,
    positions: Vec<f32>,
}

#[test]
fn hair_and_tassel_traces_and_skinned_vertices_match_javascript() {
    let Some(goldens) = golden::<PhysicsGoldens>("physics.json") else {
        return;
    };
    assert_eq!(goldens.version, 1);
    let avatar = avatar();
    let engine = RigEngine::new(&avatar.rig);
    let mut max = 0.0;
    for trace in goldens.traces {
        let mut physics = Physics::new(&avatar.rig);
        physics.gain = trace.gain;
        let mut meshes: Vec<_> = physics
            .chains
            .iter()
            .map(|ch| {
                let name = &ch.accessory.name;
                let image = &avatar.textures[&format!("{name}.png")];
                build_grid(
                    avatar.layers.layers[name].map(f64::from),
                    avatar.rig.mesh.tassel_cell as f64,
                    &image.alpha(),
                    image.width as usize,
                    None,
                )
                .unwrap()
            })
            .collect();
        for frame in trace.frames {
            let out = physics.step(&engine, &frame.parameters, frame.dt);
            compare(out.gain, frame.out.gain, &mut max);
            compare_point(out.bun_l, frame.out.bun_l, &mut max);
            compare_point(out.bun_r, frame.out.bun_r, &mut max);
            assert_eq!(out.strands.len(), frame.out.strands.len());
            for (actual, expected) in out.strands.iter().zip(&frame.out.strands) {
                for j in 0..4 {
                    compare_point(actual[j], expected[j], &mut max);
                }
            }
            assert_eq!(physics.chains.len(), frame.chains.len());
            for ((actual, expected), mesh) in
                physics.chains.iter().zip(&frame.chains).zip(&mut meshes)
            {
                assert_eq!(actual.accessory.name, expected.name);
                compare_point(actual.phi, expected.phi, &mut max);
                compare_point(actual.anchor, expected.anchor, &mut max);
                for (a, b) in actual.points.unwrap().into_iter().zip(expected.points) {
                    compare_point(a, b, &mut max);
                }
                actual.deform_grid(mesh).unwrap();
                assert_eq!(mesh.pos.len(), expected.positions.len());
                for (&a, &b) in mesh.pos.iter().zip(&expected.positions) {
                    compare(a as f64, b as f64, &mut max);
                }
            }
        }
    }
    eprintln!("Physics and tassel skinning: max delta {max} px");
}

#[derive(Deserialize)]
struct SpriteFiles {
    version: u32,
    files: Vec<String>,
}
#[derive(Deserialize)]
struct SpriteGoldens {
    version: u32,
    updates: Vec<SpriteFrame>,
}
#[derive(Deserialize)]
struct SpriteFrame {
    parameters: Parameters,
    physics: PhysicsOffsets,
    dt: f64,
    mood: Option<String>,
    coverage: SpriteCoverage,
    items: Vec<SpriteOutput>,
}
#[derive(Deserialize)]
struct SpriteOutput {
    name: String,
    visible: bool,
    alpha: f64,
    positions: Option<Vec<f32>>,
}

#[test]
fn sprite_geometry_visibility_alpha_order_and_crossfades_match_javascript() {
    let Some(files) = golden::<SpriteFiles>("sprites.json") else {
        return;
    };
    assert_eq!(files.version, 1);
    let avatar = avatar();
    let engine = RigEngine::new(&avatar.rig);
    let mut max = 0.0;
    let mut count = 0;
    for file in files.files {
        let frames: SpriteGoldens = golden(&file).expect("missing sprite golden");
        assert_eq!(frames.version, 1);
        let mut sprites =
            Sprites::new(&engine, avatar.sprites.as_ref().unwrap(), &avatar.textures).unwrap();
        for frame in frames.updates {
            count += 1;
            let coverage = sprites.update(
                &engine,
                &frame.parameters,
                &frame.physics,
                frame.dt,
                frame.mood.as_deref(),
            );
            assert_eq!(coverage, frame.coverage);
            assert_eq!(sprites.items.len(), frame.items.len());
            for (actual, expected) in sprites.items.iter().zip(&frame.items) {
                assert_eq!(actual.name, expected.name, "sprite draw order");
                assert_eq!(
                    actual.visible, expected.visible,
                    "{} visibility at frame {count}",
                    actual.name
                );
                compare(actual.alpha, expected.alpha, &mut max);
                if let Some(pos) = &expected.positions {
                    assert!(actual.visible);
                    assert_eq!(actual.mesh.pos.len(), pos.len());
                    for (&a, &b) in actual.mesh.pos.iter().zip(pos) {
                        compare(a as f64, b as f64, &mut max);
                    }
                }
            }
        }
    }
    eprintln!("Sprites: {count} updates, max delta {max} px");
}
