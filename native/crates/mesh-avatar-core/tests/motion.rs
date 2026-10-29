use mesh_avatar_core::{
    engine::{
        expression::ExpressionOverlay,
        kana::{kana_to_moras, sample_moras, skipped_kana_characters, Vowel},
        lip_sync::LipSyncSettings,
        motion::{Motion, SpeakOptions},
        physics::Physics,
        random::{RandomSource, SeededRandom},
        rig::RigEngine,
    },
    rig::Rig,
};
use serde_json::{json, Value};
use std::{fs, path::Path};

fn fixture() -> Option<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/conformance/motion.json");
    match fs::read(path) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).unwrap()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            eprintln!(
                "Motion goldens absent; skipping. Run node native/conformance/dump.mjs first."
            );
            None
        }
        Err(e) => panic!("{e}"),
    }
}
fn rig() -> Rig {
    Rig::parse(include_bytes!("../../../../samples/miko-qipao/rig.json")).unwrap()
}
fn compare(a: &Value, b: &Value, tolerance: f64, max: &mut f64) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            let d = (a.as_f64().unwrap() - b.as_f64().unwrap()).abs();
            *max = max.max(d);
            assert!(d <= tolerance, "{a} vs {b}, delta {d}");
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                compare(a, b, tolerance, max);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "keys: {a:?} vs {b:?}");
            for (k, b) in b {
                assert!(a.contains_key(k), "missing {k}");
                compare(&a[k], b, tolerance, max);
            }
        }
        _ => assert_eq!(a, b),
    }
}
#[test]
fn seeded_motion_and_physics_scenarios_match_javascript() {
    let Some(f) = fixture() else {
        return;
    };
    let rig = rig();
    let engine = RigEngine::new(&rig);
    let mut max = 0.0;
    let mut rng = SeededRandom::new(173);
    for expected in f["random"].as_array().unwrap() {
        assert_eq!(rng.next_f64(), expected.as_f64().unwrap());
    }
    for scenario in f["scenarios"].as_array().unwrap() {
        let mut motion = Motion::with_rng(
            rig.view
                .gaze_center
                .unwrap_or([rig.head.ellipse.cx, rig.head.ellipse.cy]),
            Box::new(SeededRandom::new(173)),
        );
        let mut physics = Physics::new(&rig);
        motion.auto_motion = scenario["name"] == "automatic";
        motion.auto_idle = scenario["name"] == "idle";
        if scenario["name"] == "speech" {
            motion.speak_kana(
                "こんにちは。きょうも、いっしょにあいうえおをれんしゅうしましょう。",
                SpeakOptions {
                    looping: true,
                    ..Default::default()
                },
            );
        }
        let mut sample = 0;
        for frame in 0..1200 {
            for event in scenario["schedule"].as_array().unwrap() {
                if event["frame"] == frame {
                    if let Some(id) = event["id"].as_str() {
                        motion.play_motion(id);
                    } else {
                        motion.set_emotion(event["tag"].as_str().unwrap(), true);
                    }
                }
            }
            let p = motion.update(1.0 / 60.0);
            let out = physics.step(&engine, &p, 1.0 / 60.0);
            if frame % 60 == 0 || frame == 1199 {
                let expected = &scenario["samples"][sample];
                sample += 1;
                assert_eq!(expected["frame"], frame);
                compare(
                    &serde_json::to_value(p).unwrap(),
                    &expected["parameters"],
                    1e-6,
                    &mut max,
                );
                compare(
                    &serde_json::to_value(out).unwrap(),
                    &expected["offsets"],
                    1e-3,
                    &mut max,
                );
                let chains: Vec<_> = physics
                    .chains
                    .iter()
                    .map(|ch| json!({"phi":ch.phi,"points":ch.points.unwrap()}))
                    .collect();
                compare(&json!(chains), &expected["chains"], 1e-3, &mut max);
            }
        }
        assert_eq!(sample, 21);
    }
    eprintln!("Seeded motion/physics: max delta {max}");
}

fn action(motion: &mut Motion, overlay: &mut ExpressionOverlay, event: &Value) {
    let arg = &event[2];
    match event[1].as_str().unwrap() {
        "setAutoIdle" => motion.auto_idle = arg.as_bool().unwrap(),
        "setAutoMotion" => motion.auto_motion = arg.as_bool().unwrap(),
        "setSpeaking" => motion.set_speaking(arg.as_bool().unwrap()),
        "setEmotion" => motion.set_emotion(
            arg.as_str().unwrap(),
            event
                .get(3)
                .and_then(|v| v.get("playMotion"))
                .and_then(Value::as_bool)
                .unwrap_or(true),
        ),
        "setExpression" => overlay.set(arg.as_str().unwrap()),
        "speakKana" => motion.speak_kana(
            arg.as_str().unwrap(),
            event
                .get(3)
                .map(|v| serde_json::from_value(v.clone()).unwrap())
                .unwrap_or_default(),
        ),
        "setLipSync" => motion
            .set_lip_sync(&LipSyncSettings::parse(arg).unwrap())
            .unwrap(),
        "holdMouth" => motion.hold_mouth(Vowel::parse(arg.as_str().unwrap())),
        "stopLipSync" => motion.stop_lip_sync(),
        _ => panic!("unknown action"),
    }
}
#[test]
fn speech_settings_and_expression_sequences_match_javascript() {
    let Some(f) = fixture() else {
        return;
    };
    let rig = rig();
    let mut motion = Motion::with_rng(
        rig.view
            .gaze_center
            .unwrap_or([rig.head.ellipse.cx, rig.head.ellipse.cy]),
        Box::new(SeededRandom::new(173)),
    );
    let mut overlay = ExpressionOverlay::default();
    let mut max = 0.0;
    for update in f["updates"].as_array().unwrap() {
        for event in f["actions"].as_array().unwrap() {
            if event[0] == update["frame"] {
                action(&mut motion, &mut overlay, event);
            }
        }
        motion.set_voice_level(update["voice"].as_f64().unwrap());
        let dt = update["dt"].as_f64().unwrap();
        let p = motion.update(dt);
        let output = overlay.apply(&p, dt);
        compare(
            &serde_json::to_value(p).unwrap(),
            &update["parameters"],
            1e-6,
            &mut max,
        );
        compare(
            &serde_json::to_value(output).unwrap(),
            &update["output"],
            1e-6,
            &mut max,
        );
        compare(
            &json!({"name":overlay.name,"active":overlay.active()}),
            &update["expression"],
            0.0,
            &mut max,
        );
        compare(
            &serde_json::to_value(motion.lip_sync_state()).unwrap(),
            &update["lipSync"],
            1e-6,
            &mut max,
        );
    }
    eprintln!("Speech/expression: max delta {max}");
}
#[test]
fn kana_timing_and_grouping_match_javascript() {
    let Some(f) = fixture() else {
        return;
    };
    let mut max = 0.0;
    for case in f["kana"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        let moras = kana_to_moras(text, 0.14);
        compare(
            &serde_json::to_value(&moras).unwrap(),
            &case["moras"],
            1e-12,
            &mut max,
        );
        let skipped: Vec<_> = skipped_kana_characters(text)
            .into_iter()
            .map(|c| c.to_string())
            .collect();
        assert_eq!(json!(skipped), case["skipped"]);
        for sample in case["samples"].as_array().unwrap() {
            let target = sample_moras(
                &moras,
                sample["t"].as_f64().unwrap(),
                case["granularity"].as_f64().unwrap(),
            );
            compare(
                &serde_json::to_value(target).unwrap(),
                &sample["target"],
                1e-12,
                &mut max,
            );
        }
    }
}

#[test]
fn manual_and_pointer_modes_with_keyframes_match_javascript() {
    let Some(f) = fixture() else {
        return;
    };
    let mut max = 0.0;
    for mode in f["modes"].as_array().unwrap() {
        let mut motion = Motion::with_rng([600.0, 500.0], Box::new(SeededRandom::new(173)));
        motion.mode = serde_json::from_value(mode["mode"].clone()).unwrap();
        motion.set_expression("shy");
        motion.manual.angle_x = 12.0;
        motion.manual.eye_l_open = 0.4;
        motion.manual.breath = 0.6;
        for (frame, sample) in mode["samples"].as_array().unwrap().iter().enumerate() {
            if frame == 30 {
                motion.play_motion("tilt");
            }
            motion.pointer = Some(serde_json::from_value(sample["pointer"].clone()).unwrap());
            compare(
                &serde_json::to_value(motion.update(1.0 / 60.0)).unwrap(),
                &sample["parameters"],
                1e-6,
                &mut max,
            );
        }
    }
    eprintln!("Manual/pointer modes: max delta {max}");
}
