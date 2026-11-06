use mesh_avatar_core::{
    engine::{
        motion::{Mode, Motion},
        random::{RandomSource, SeededRandom},
        rig::{Parameters, PhysicsOffsets, RigEngine},
    },
    rig::{Point, Rig},
};
use serde_json::Value;
use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

fn fixture() -> Option<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/conformance/limbs.json");
    match fs::read(path) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).unwrap()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            assert!(std::env::var_os("CI").is_none(), "Leg/arm goldens required in CI. Run node --experimental-strip-types native/conformance/dump.mjs first.");
            eprintln!("Leg/arm goldens absent; skipping.");
            None
        }
        Err(e) => panic!("{e}"),
    }
}
fn compare(actual: &Value, expected: &Value, max: &mut f64) {
    match (actual, expected) {
        (Value::Number(a), Value::Number(b)) => {
            let a = a.as_f64().unwrap();
            let b = b.as_f64().unwrap();
            let delta = (a - b).abs();
            *max = max.max(delta);
            assert!(
                a.is_finite() && b.is_finite() && delta <= 1e-6,
                "{a} vs {b}, delta {delta}"
            );
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len());
            for (a, b) in a.iter().zip(b) {
                compare(a, b, max);
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "keys: {a:?} vs {b:?}");
            for (key, value) in b {
                compare(&a[key], value, max);
            }
        }
        _ => assert_eq!(actual, expected),
    }
}
fn pose(
    engine: &RigEngine<'_>,
    points: &[Point],
    expected: &Value,
    phys: &PhysicsOffsets,
    max: &mut f64,
) {
    let p: Parameters = serde_json::from_value(expected["parameters"].clone()).unwrap();
    compare(
        &serde_json::to_value(engine.leg_frame(&p)).unwrap(),
        &expected["legFrame"],
        max,
    );
    let frame = engine.hand_frame(&p);
    for (i, &[x, y]) in points.iter().enumerate() {
        let w = engine.base_weights(x, y, 0.0);
        let hand = engine.deform_hand(x, y, &engine.hand_weights(x, y), &p, &frame);
        let base = engine.deform_base(x, y, &w, &p, phys);
        if engine
            .rig
            .legs
            .as_ref()
            .is_some_and(|legs| y >= legs.left.ankle[1].min(legs.right.ankle[1]))
        {
            assert_eq!(base, [x, y], "planted feet must remain exactly fixed");
        }
        let mut body = [x, y];
        engine.apply_body(&mut body, y, &p, 0.0, 1.0, 0.0);
        for (name, actual) in [("base", base), ("hand", hand), ("body", body)] {
            compare(
                &serde_json::to_value(actual).unwrap(),
                &expected[name][i],
                max,
            );
        }
    }
}

#[test]
fn leg_arm_weights_poses_and_body_springs_match_javascript() {
    let Some(f) = fixture() else {
        return;
    };
    let physics = serde_json::from_value(f["physics"].clone()).unwrap();
    let mut max = 0.0;
    for variant in f["variants"].as_array().unwrap() {
        let rig = Rig::parse(&serde_json::to_vec(&variant["rig"]).unwrap()).unwrap();
        let engine = RigEngine::new(&rig);
        let points: Vec<Point> = serde_json::from_value(variant["points"].clone()).unwrap();
        for (i, &[x, y]) in points.iter().enumerate() {
            compare(
                &serde_json::to_value(engine.base_weights(x, y, 0.0)).unwrap(),
                &variant["weights"][i],
                &mut max,
            );
        }
        for expected in variant["staticPoses"].as_array().unwrap() {
            pose(&engine, &points, expected, &physics, &mut max);
        }
        let trace_points =
            serde_json::from_value::<Vec<Point>>(variant["tracePoints"].clone()).unwrap();
        for expected in variant["trace"].as_array().unwrap() {
            let p = serde_json::from_value(expected["parameters"].clone()).unwrap();
            engine.step_body(&p, expected["dt"].as_f64().unwrap());
            pose(&engine, &trace_points, expected, &physics, &mut max);
        }
        eprintln!(
            "{} weights/geometry/body springs: max delta {max}",
            variant["name"]
        );
    }
}

#[test]
fn planted_and_arm_motion_modes_match_javascript_without_extra_random_draws() {
    let Some(f) = fixture() else {
        return;
    };
    let mut max = 0.0;
    for variant in f["variants"].as_array().unwrap() {
        let rig = Rig::parse(&serde_json::to_vec(&variant["rig"]).unwrap()).unwrap();
        for mode in variant["modes"].as_array().unwrap() {
            let rng = Arc::new(Mutex::new(SeededRandom::new(173)));
            let shared = rng.clone();
            let mut motion = Motion::with_rng(
                [600.0, 500.0],
                Box::new(move || shared.lock().unwrap().next_f64()),
            );
            motion.configure_rig(&rig);
            motion.mode = match mode["mode"].as_str().unwrap() {
                "manual" => Mode::Manual,
                "mouse" => Mode::Mouse,
                _ => Mode::Auto,
            };
            motion.auto_idle = mode["mode"] == "idle";
            motion.auto_motion = mode["mode"] == "auto";
            for (frame, sample) in mode["samples"].as_array().unwrap().iter().enumerate() {
                motion.manual = serde_json::from_value(sample["manual"].clone()).unwrap();
                motion.pointer = Some(serde_json::from_value(sample["pointer"].clone()).unwrap());
                if frame == 30 {
                    motion.play_motion("tilt");
                }
                let p = motion.update(sample["dt"].as_f64().unwrap());
                compare(
                    &serde_json::to_value(p).unwrap(),
                    &sample["parameters"],
                    &mut max,
                );
            }
            assert_eq!(
                rng.lock().unwrap().next_f64(),
                mode["nextRandom"].as_f64().unwrap()
            );
        }
    }
    eprintln!("Leg/arm motion modes: max delta {max}");
}

#[test]
fn neutral_limbs_and_absent_limbs_preserve_legacy_geometry_exactly() {
    let Some(f) = fixture() else {
        return;
    };
    let legacy = Rig::parse(include_bytes!("../../../../samples/miko-qipao/rig.json")).unwrap();
    let old = RigEngine::new(&legacy);
    let physics = PhysicsOffsets {
        gain: 0.0,
        ..Default::default()
    };
    let neutral = Parameters::default();
    let changed = Parameters {
        weight_shift: 1.0,
        arm_swing_l: 1.0,
        arm_swing_r: -1.0,
        elbow_bend_l: 1.0,
        elbow_bend_r: 1.0,
        ..Default::default()
    };
    for variant in f["variants"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|v| v["name"] != "hip" && v["name"] != "twist")
    {
        let rig = Rig::parse(&serde_json::to_vec(&variant["rig"]).unwrap()).unwrap();
        let engine = RigEngine::new(&rig);
        let points: Vec<Point> = serde_json::from_value(variant["points"].clone()).unwrap();
        for [x, y] in points {
            let w = old.base_weights(x, y, 0.0);
            let expected = old.deform_base(x, y, &w, &neutral, &physics);
            assert_eq!(old.deform_base(x, y, &w, &changed, &physics), expected);
            assert_eq!(
                engine.deform_base(x, y, &engine.base_weights(x, y, 0.0), &neutral, &physics),
                expected
            );
        }
    }
    eprintln!("Neutral/absent limbs regression: max delta 0 px");
}

#[test]
fn limb_defaults_and_validation_match_javascript() {
    let Some(f) = fixture() else {
        return;
    };
    for case in f["validation"].as_array().unwrap() {
        let result = Rig::parse(&serde_json::to_vec(&case["rig"]).unwrap());
        assert_eq!(
            result.is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}: {result:?}",
            case["path"]
        );
    }
    let variant = f["variants"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["name"] == "legs-arms")
        .unwrap();
    let mut rig = Rig::parse(&serde_json::to_vec(&variant["rig"]).unwrap()).unwrap();
    let legs = rig.legs.as_ref().unwrap();
    assert_eq!((legs.spine, legs.bob, legs.twist), (0.7, 2.0, 0.0));
    let arms = rig.arms.as_ref().unwrap();
    assert_eq!((arms.swing, arms.bend, arms.inward), (4.0, 6.0, 0.4));
    rig.legs.as_mut().unwrap().tilt = f64::NAN;
    assert!(rig.validate().is_err());
    rig.legs.as_mut().unwrap().tilt = 0.04;
    rig.arms.as_mut().unwrap().left.elbow[0] = f64::INFINITY;
    assert!(rig.validate().is_err());
}
