use mesh_avatar_core::{
    engine::{
        grid::Grid, kana::Vowel, lip_sync::LipSyncSettings, random::SeededRandom, rig::Parameters,
    },
    format::{AvatarPackage, OverlayMetadata, Texture},
    Avatar, AvatarOptions, FaceUniforms,
};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::Path};

fn read<T: DeserializeOwned>(name: &str) -> Option<T> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/conformance")
        .join(name);
    match fs::read(path) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).unwrap()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            eprintln!("{name} absent; skipping. Run node native/conformance/dump.mjs first.");
            None
        }
        Err(e) => panic!("{e}"),
    }
}
fn package() -> AvatarPackage {
    AvatarPackage::open(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../samples/miko-qipao"))
        .unwrap()
}
fn compare(a: f64, b: f64, tolerance: f64, max: &mut f64) {
    let delta = (a - b).abs();
    assert!(a.is_finite() && b.is_finite());
    *max = max.max(delta);
    assert!(delta <= tolerance, "{a} vs {b}, delta {delta}");
}
fn compare_json(a: &Value, b: &Value, max: &mut f64) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            compare(a.as_f64().unwrap(), b.as_f64().unwrap(), 1e-6, max)
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                compare_json(a, b, max);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len());
            for (k, b) in b {
                compare_json(&a[k], b, max);
            }
        }
        _ => assert_eq!(a, b),
    }
}
#[derive(Deserialize)]
struct Index {
    version: u32,
    files: Vec<String>,
}
#[derive(Deserialize)]
struct Sequence {
    version: u32,
    #[serde(rename = "hasSprites")]
    has_sprites: bool,
    #[serde(rename = "preserveMouthForm")]
    preserve_mouth_form: bool,
    #[serde(default)]
    overlays: Option<OverlayMetadata>,
    #[serde(default, rename = "overlayGrids")]
    overlay_grids: Vec<NamedGrid>,
    actions: Vec<Value>,
    samples: Vec<Sample>,
}
#[derive(Deserialize)]
struct Sample {
    frame: usize,
    dt: f64,
    voice: f64,
    parameters: Parameters,
    layers: Vec<Layer>,
    uniforms: FaceUniforms,
    expression: Value,
    #[serde(rename = "lipSync")]
    lip_sync: Value,
    events: Vec<Option<String>>,
}
#[derive(Deserialize)]
struct Layer {
    name: String,
    texture: String,
    rect: [f64; 4],
    positions: Vec<f32>,
    alpha: f64,
    face: bool,
    eye_ball: Option<usize>,
}
#[derive(Deserialize)]
struct Grids {
    grids: Vec<NamedGrid>,
}
#[derive(Deserialize)]
struct NamedGrid {
    name: String,
    mesh: Grid,
}

fn action(avatar: &mut Avatar, event: &Value) {
    let arg = &event[2];
    match event[1].as_str().unwrap() {
        "setAutoIdle" => avatar.set_auto_idle(arg.as_bool().unwrap()),
        "setAutoMotion" => avatar.set_auto_motion(arg.as_bool().unwrap()),
        "play" => avatar.play(arg.as_str().unwrap()),
        "setSpeaking" => avatar.set_speaking(arg.as_bool().unwrap()),
        "setEmotion" => avatar.set_emotion_with_motion(
            arg.as_str().unwrap(),
            event
                .get(3)
                .and_then(|v| v.get("playMotion"))
                .and_then(Value::as_bool)
                .unwrap_or(true),
        ),
        "setExpression" => avatar.set_expression(arg.as_str().unwrap()),
        "setOverlays" => avatar.set_overlays(
            &arg.as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap())
                .collect::<Vec<_>>(),
        ),
        "speakKana" => avatar.speak_kana(
            arg.as_str().unwrap(),
            event
                .get(3)
                .map(|v| serde_json::from_value(v.clone()).unwrap())
                .unwrap_or_default(),
        ),
        "setParameters" => avatar.set_parameters_weighted(
            serde_json::from_value(arg.clone()).unwrap(),
            event.get(3).and_then(Value::as_f64).unwrap_or(1.0),
        ),
        "setLipSync" => avatar
            .set_lip_sync(&LipSyncSettings::parse(arg).unwrap())
            .unwrap(),
        "holdMouth" => avatar.hold_mouth(Vowel::parse(arg.as_str().unwrap()).unwrap()),
        "stopLipSync" => avatar.stop_lip_sync(),
        "setSwayGain" => avatar.set_sway_gain(arg.as_f64().unwrap()),
        _ => panic!("unknown action"),
    }
}
#[test]
fn full_avatar_tick_draw_list_and_uniforms_match_real_javascript_tick_path() {
    let Some(index) = read::<Index>("avatar.json") else {
        return;
    };
    assert_eq!(index.version, 1);
    let grids = read::<Grids>("grids.json").unwrap();
    let mut max_positions = 0.0;
    let mut max_uniforms = 0.0;
    let mut count = 0;
    for file in index.files {
        let expected = read::<Sequence>(&file).unwrap();
        assert_eq!(expected.version, 1);
        let mut package = package();
        if !expected.has_sprites {
            package.sprites = None;
        }
        if let Some(overlays) = &expected.overlays {
            for item in &overlays.overlays {
                let name = format!("overlays/{}", item.file);
                let bytes = fs::read(
                    Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("../../target/conformance")
                        .join(&name),
                )
                .unwrap();
                package
                    .textures
                    .insert(name, Texture::decode(&bytes).unwrap());
            }
        }
        package.overlays = expected.overlays.clone();
        let mut avatar = Avatar::with_rng(
            package,
            AvatarOptions {
                preserve_mouth_form: expected.preserve_mouth_form,
                ..Default::default()
            },
            Box::new(SeededRandom::new(173)),
        )
        .unwrap();
        let overlay_grids = &expected.overlay_grids;
        let mut sample = 0;
        let mut events = vec![];
        for frame in 0..1200 {
            for event in &expected.actions {
                if event[0] == frame {
                    action(&mut avatar, event);
                }
            }
            let dt = if frame == 600 {
                0.0
            } else if frame == 900 {
                0.08
            } else {
                1.0 / 60.0
            };
            let voice = 0.5 + (frame as f64 * 0.73).sin() * 0.45;
            avatar.set_voice_level(voice);
            let output = avatar.tick(dt);
            events.extend(output.motion_events);
            if frame % 60 > 4 && frame != 1199 {
                continue;
            }
            let expected = &expected.samples[sample];
            sample += 1;
            count += 1;
            assert_eq!(expected.frame, frame);
            assert_eq!(expected.dt, dt);
            compare(voice, expected.voice, 1e-12, &mut max_uniforms);
            compare_json(
                &serde_json::to_value(avatar.parameters()).unwrap(),
                &serde_json::to_value(&expected.parameters).unwrap(),
                &mut max_uniforms,
            );
            assert_eq!(output.layers.len(), expected.layers.len());
            for (actual, expected) in output.layers.iter().zip(&expected.layers) {
                assert_eq!(actual.name, expected.name, "draw order at frame {frame}");
                assert_eq!(actual.texture, expected.texture);
                assert_eq!(actual.rect, expected.rect);
                assert_eq!(actual.face, expected.face);
                assert_eq!(actual.eye_ball, expected.eye_ball);
                compare(actual.alpha, expected.alpha, 1e-6, &mut max_uniforms);
                assert_eq!(actual.positions.len(), expected.positions.len());
                for (&a, &b) in actual.positions.iter().zip(&expected.positions) {
                    compare(a as f64, b as f64, 1e-3, &mut max_positions);
                }
                let grid = &grids
                    .grids
                    .iter()
                    .chain(overlay_grids)
                    .find(|g| g.name == actual.name)
                    .unwrap()
                    .mesh;
                assert_eq!(actual.uvs, grid.uv);
                assert_eq!(actual.indices, grid.tris);
            }
            compare_json(
                &serde_json::to_value(output.uniforms).unwrap(),
                &serde_json::to_value(&expected.uniforms).unwrap(),
                &mut max_uniforms,
            );
            let (name, active) = avatar.expression();
            assert_eq!(json!({"name":name,"active":active}), expected.expression);
            compare_json(
                &serde_json::to_value(avatar.lip_sync_state()).unwrap(),
                &expected.lip_sync,
                &mut max_uniforms,
            );
            assert_eq!(events, expected.events);
            events.clear();
        }
        assert_eq!(sample, expected.samples.len());
    }
    eprintln!("Full Avatar: {count} captured frames, max position delta {max_positions} px, max parameter/uniform delta {max_uniforms}");
}

#[test]
fn public_api_validates_settings_and_exposes_owned_texture_and_frame_data() {
    let mut avatar = Avatar::from_package(package()).unwrap();
    assert!(!avatar.motions().is_empty());
    assert!(avatar.textures().contains_key("base.png"));
    avatar.set_auto_idle(false);
    avatar.set_auto_motion(false);
    avatar.set_talk_gain(0.5);
    avatar.set_parameters(BTreeMap::from([("angleX".into(), 12.0)]));
    avatar.tick(0.0);
    assert_eq!(avatar.parameters().angle_x, 12.0);
    avatar.set_emotion("neutral");
    avatar.play("missing-motion");
    avatar.hold_mouth(Vowel::A);
    avatar.tick(1.0 / 60.0);
    assert!(avatar.lip_sync_state().active);
    avatar.stop_lip_sync();
    assert!(!avatar.lip_sync_state().active);
    for value in [
        json!(null),
        json!({"openness":null}),
        json!({"granularity":-1}),
        json!({"closeSpeed":2}),
        json!({"preset":"unknown"}),
    ] {
        assert!(LipSyncSettings::parse(&value).is_err());
    }
    assert!(avatar
        .set_lip_sync(&LipSyncSettings {
            openness: Some(f64::NAN),
            ..Default::default()
        })
        .is_err());
}

#[test]
fn hidden_overlays_preserve_frames_and_visible_overlays_follow_manifest_draw_order() {
    use mesh_avatar_core::format::OverlayDefinition;
    let mut baseline = Avatar::from_package(package()).unwrap();
    let mut package = package();
    let (width, height) = (package.rig.image.width, package.rig.image.height);
    let mut image = Texture {
        width,
        height,
        rgba: vec![0; (width * height * 4) as usize],
    };
    let i = ((height / 3 * width + width / 3) * 4) as usize;
    image.rgba[i..i + 4].copy_from_slice(&[30, 80, 120, 128]);
    package.textures.insert("overlays/frame.png".into(), image);
    package.overlays = Some(OverlayMetadata {
        version: 1,
        overlays: ["z-last", "a-first"]
            .map(|name| OverlayDefinition {
                name: name.into(),
                file: "frame.png".into(),
            })
            .to_vec(),
    });
    let accessories: Vec<_> = package
        .rig
        .accessories
        .iter()
        .map(|item| item.name.clone())
        .collect();
    let has_hand = package.rig.hand.is_some();
    let mut avatar = Avatar::from_package(package).unwrap();
    for runtime in [&mut baseline, &mut avatar] {
        runtime.set_auto_idle(false);
        runtime.set_auto_motion(false);
        runtime.set_parameters(BTreeMap::from([
            ("angleX".into(), 30.0),
            ("browY".into(), 1.0),
            ("mouthOpen".into(), 1.0),
        ]));
    }
    for dt in [0.0, 1.0 / 60.0, 0.05] {
        assert_eq!(
            serde_json::to_value(avatar.tick(dt)).unwrap(),
            serde_json::to_value(baseline.tick(dt)).unwrap()
        );
    }
    avatar.set_overlays(&["a-first", "unknown", "z-last"]);
    let mut shown = avatar.tick(0.0);
    let position = |name: &str| {
        shown
            .layers
            .iter()
            .position(|layer| layer.name == name)
            .unwrap()
    };
    let first = position("overlay_z-last");
    assert_eq!(position("overlay_a-first"), first + 1);
    for name in &accessories {
        assert!(position(name) > first + 1);
    }
    if has_hand {
        assert!(position("hand") > first + 1);
    }
    assert!(shown.layers[..first]
        .iter()
        .all(|layer| !layer.texture.starts_with("overlays/")));
    shown
        .layers
        .retain(|layer| !layer.texture.starts_with("overlays/"));
    assert_eq!(
        serde_json::to_value(shown).unwrap(),
        serde_json::to_value(baseline.tick(0.0)).unwrap()
    );
    avatar.set_overlays(&["unknown"]);
    assert_eq!(
        serde_json::to_value(avatar.tick(0.0)).unwrap(),
        serde_json::to_value(baseline.tick(0.0)).unwrap()
    );
}
