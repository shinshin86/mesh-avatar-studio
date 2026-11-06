use mesh_avatar_core::{
    engine::{
        cloth::ClothPhysics,
        cloth_pendulum::PendulumSystem,
        grid::Grid,
        motion::Motion,
        physics::Physics,
        random::{RandomSource, SeededRandom},
        rig::RigEngine,
    },
    rig::{ClothTuningUpdate, Rig},
};
use serde_json::{json, Value};
use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
};
fn fixture() -> Option<Value> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/conformance/cloth.json");
    match fs::read(path) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).unwrap()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            assert!(
                std::env::var_os("CI").is_none(),
                "cloth.json required in CI; run native/conformance/dump.mjs"
            );
            eprintln!("cloth.json absent; skipping. Run native/conformance/dump.mjs.");
            None
        }
        Err(e) => panic!("{e}"),
    }
}
fn compare(a: &Value, b: &Value, max: &mut f64, ctx: &str) {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => {
            let a = a.as_f64().unwrap();
            let b = b.as_f64().unwrap();
            let d = (a - b).abs();
            assert!(
                a.is_finite() && b.is_finite() && d <= 1e-6,
                "{ctx}: {a} vs {b}, delta {d}"
            );
            *max = max.max(d);
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{ctx}");
            for (i, (a, b)) in a.iter().zip(b).enumerate() {
                compare(a, b, max, &format!("{ctx}[{i}]"));
            }
        }
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{ctx}");
            for (k, b) in b {
                compare(&a[k], b, max, &format!("{ctx}.{k}"));
            }
        }
        _ => assert_eq!(a, b, "{ctx}"),
    }
}
#[test]
fn cloth_grids_physics_skinning_and_seeded_motion_match_javascript() {
    let Some(f) = fixture() else {
        return;
    };
    let mut max = 0.0;
    for sequence in f["sequences"].as_array().unwrap() {
        let rig = Rig::parse(&serde_json::to_vec(&sequence["rig"]).unwrap()).unwrap();
        let engine = RigEngine::new(&rig);
        let mut physics = Physics::new(&rig);
        let rng = Arc::new(Mutex::new(SeededRandom::new(173)));
        let shared = rng.clone();
        let mut motion = Motion::with_rng(
            rig.view
                .gaze_center
                .unwrap_or([rig.head.ellipse.cx, rig.head.ellipse.cy]),
            Box::new(move || shared.lock().unwrap().next_f64()),
        );
        motion.configure_rig(&rig);
        let mut cloth = ClothPhysics::new(&engine, &rig).unwrap();
        for (g, e) in cloth
            .garments
            .iter()
            .zip(sequence["initial"].as_array().unwrap())
        {
            compare(
                &json!({"grid":g.grid,"gravity":g.gravity,"rest":g.rest,"tuning":g.tuning}),
                e,
                &mut max,
                "initial",
            );
        }
        for m in sequence["meshes"].as_array().unwrap() {
            let mesh: Grid = serde_json::from_value(m["mesh"].clone()).unwrap();
            cloth.attach(m["name"].as_str().unwrap(), mesh).unwrap();
        }
        let samples = sequence["samples"].as_array().unwrap();
        if sequence["longTrace"] == true {
            assert_eq!(samples.len(), 1800);
        }
        for sample in samples {
            let frame = sample["frame"].as_u64().unwrap();
            let dt = sample["dt"].as_f64().unwrap();
            for a in sequence["actions"].as_array().unwrap() {
                if a[0] == frame {
                    cloth
                        .set_tuning(
                            a[1].as_str(),
                            &serde_json::from_value(a[2].clone()).unwrap(),
                        )
                        .unwrap();
                }
            }
            cloth.gain = sample["gain"].as_f64().unwrap();
            let p = motion.update(dt.max(0.0));
            compare(
                &serde_json::to_value(&p).unwrap(),
                &sample["parameters"],
                &mut max,
                "motion",
            );
            let phys = physics.step(&engine, &p, dt.max(0.0));
            cloth.step(&engine, &p, dt, phys);
            cloth.deform();
            compare(&json!(cloth.time), &sample["time"], &mut max, "time");
            for (i, g) in cloth.garments.iter().enumerate() {
                for values in [
                    &g.out,
                    &g.physical_out,
                    &g.target,
                    &g.angle,
                    &g.angular_velocity,
                    &g.lower_angle,
                    &g.lower_angular_velocity,
                    &g.bounce,
                    &g.bounce_velocity,
                ] {
                    assert!(
                        values.iter().all(|v| v.is_finite()),
                        "{} frame {frame}",
                        sequence["variant"]
                    );
                }
                assert!(g.meshes[0].mesh.pos.iter().all(|v| v.is_finite()));
                if !g.grid.custom {
                    for k in 0..g.grid.cols {
                        let top = k * 2;
                        let bottom = ((g.grid.rows - 1) * g.grid.cols + k) * 2;
                        if (g.rest[bottom] - g.rest[top])
                            .hypot(g.rest[bottom + 1] - g.rest[top + 1])
                            > 1.0
                        {
                            continue;
                        }
                        assert_eq!(
                            [
                                g.angle[k],
                                g.angular_velocity[k],
                                g.lower_angle[k],
                                g.lower_angular_velocity[k],
                                g.bounce[k],
                                g.bounce_velocity[k]
                            ],
                            [0.0; 6]
                        );
                        for r in 0..g.grid.rows {
                            for axis in 0..2 {
                                let i = (r * g.grid.cols + k) * 2 + axis;
                                assert!((g.out[i] - g.target[i]).abs() < 1e-10);
                            }
                        }
                    }
                }
                let actual = json!({"out":g.out,"physicalOut":g.physical_out,"target":g.target,"angle":g.angle,"angularVelocity":g.angular_velocity,
                    "lowerAngle":g.lower_angle,"lowerAngularVelocity":g.lower_angular_velocity,"bounce":g.bounce,"bounceVelocity":g.bounce_velocity,"pendulums":g.pendulums});
                compare(
                    &actual,
                    &sample["garments"][i],
                    &mut max,
                    &format!("{} frame {frame} garment {i}", sequence["variant"]),
                );
                compare(
                    &json!(g.meshes[0].mesh.pos),
                    &sample["positions"][i],
                    &mut max,
                    "skinning",
                );
            }
        }
        assert_eq!(
            rng.lock().unwrap().next_f64(),
            sequence["nextRandom"].as_f64().unwrap()
        );
    }
    eprintln!("Cloth grid/physics/skinning/motion max delta {max}; RNG exact");
}
#[test]
fn serial_pendulums_match_javascript_and_dissipate_free_energy() {
    let Some(f) = fixture() else {
        return;
    };
    let mut max = 0.0;
    for case in f["systems"].as_array().unwrap() {
        let lengths = serde_json::from_value(case["initial"]["lengths"].clone()).unwrap();
        let mut s = PendulumSystem::new(lengths, 4903.325, 0.25, 0.48);
        s.angles = serde_json::from_value(case["initial"]["angles"].clone()).unwrap();
        compare(
            &serde_json::to_value(&s).unwrap(),
            &case["initial"],
            &mut max,
            "pendulum initial",
        );
        let initial = s.energy(&s.angles, &s.velocities);
        let mut previous = initial;
        let mut sample = 0;
        for frame in 0..2400 {
            s.step(1.0 / 480.0, 0.0, 1.0);
            let energy = s.energy(&s.angles, &s.velocities);
            assert!(energy <= previous + initial * 1e-12);
            previous = energy;
            if frame % 40 == 0 || frame == 2399 {
                compare(
                    &serde_json::to_value(&s).unwrap(),
                    &case["samples"][sample]["state"],
                    &mut max,
                    "pendulum trace",
                );
                sample += 1;
            }
        }
        assert!(previous < initial * 0.001);
    }
    eprintln!("Serial pendulum max delta {max}");
}
#[test]
fn cloth_validation_live_tuning_atomicity_and_empty_regression() {
    let Some(f) = fixture() else {
        return;
    };
    for case in f["validation"].as_array().unwrap() {
        let result = Rig::parse(&serde_json::to_vec(&case["rig"]).unwrap());
        assert_eq!(
            result.is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}: {result:?}",
            case["label"]
        );
    }
    let rig = Rig::parse(&serde_json::to_vec(&f["sequences"][1]["rig"]).unwrap()).unwrap();
    let before = serde_json::to_value(&rig).unwrap();
    let engine = RigEngine::new(&rig);
    let mut cloth = ClothPhysics::new(&engine, &rig).unwrap();
    let update = |v: Value| serde_json::from_value::<ClothTuningUpdate>(v).unwrap();
    cloth
        .set_tuning(Some("tail"), &update(json!({"swing":0.5})))
        .unwrap();
    assert_eq!(cloth.garments[0].tuning.swing, 1.0);
    assert_eq!(cloth.garments[1].tuning.swing, 0.5);
    let tuning = cloth
        .garments
        .iter()
        .map(|g| serde_json::to_value(&g.tuning).unwrap())
        .collect::<Vec<_>>();
    assert!(cloth
        .set_tuning(None, &update(json!({"swing":2,"follow":10})))
        .is_err());
    assert!(cloth
        .set_tuning(Some("missing"), &ClothTuningUpdate::default())
        .is_err());
    assert_eq!(
        tuning,
        cloth
            .garments
            .iter()
            .map(|g| serde_json::to_value(&g.tuning).unwrap())
            .collect::<Vec<_>>()
    );
    assert_eq!(before, serde_json::to_value(&rig).unwrap());
    for v in [
        json!({"unknown":1}),
        json!({"swing":null}),
        json!([]),
        Value::Null,
    ] {
        assert!(serde_json::from_value::<ClothTuningUpdate>(v).is_err());
    }
    assert!(cloth
        .set_tuning(
            None,
            &ClothTuningUpdate {
                wind: Some(f64::NAN),
                ..Default::default()
            }
        )
        .is_err());
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../samples/miko-qipao");
    let package = mesh_avatar_core::format::AvatarPackage::open(&path).unwrap();
    let mut explicit = mesh_avatar_core::format::AvatarPackage::open(&path).unwrap();
    explicit.rig.cloth = vec![];
    let mut a = mesh_avatar_core::Avatar::from_package(package).unwrap();
    let mut b = mesh_avatar_core::Avatar::from_package(explicit).unwrap();
    b.set_cloth_tuning(None, &update(json!({"wind":0.4})))
        .unwrap();
    for _ in 0..60 {
        assert_eq!(
            serde_json::to_value(a.tick(1.0 / 60.0)).unwrap(),
            serde_json::to_value(b.tick(1.0 / 60.0)).unwrap()
        );
    }
    eprintln!("Empty/absent cloth regression: max delta 0 px");
}
