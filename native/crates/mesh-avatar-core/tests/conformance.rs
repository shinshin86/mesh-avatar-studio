use mesh_avatar_core::{
    engine::grid::{build_grid, Grid},
    format::AvatarPackage,
    rig::FineGrid,
};
use serde::Deserialize;
use std::{fs, path::Path};

#[derive(Deserialize)]
struct Golden {
    version: u32,
    grids: Vec<Layer>,
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Layer {
    name: String,
    texture: String,
    cell: f64,
    fine: Option<FineGrid>,
    mesh: Grid,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    rect: [f64; 4],
    cell: f64,
    alpha: Vec<u8>,
    width: usize,
    fine: Option<FineGrid>,
    mesh: Grid,
}

#[test]
fn every_sample_grid_matches_javascript_exactly() {
    let native = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let golden_path = native.join("target/conformance/grids.json");
    let bytes = match fs::read(&golden_path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            eprintln!("Grid goldens absent; skipping. Run node native/conformance/dump.mjs first.");
            return;
        }
        Err(e) => panic!("could not read grid goldens: {e}"),
    };
    let golden: Golden = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(golden.version, 1);
    let avatar = AvatarPackage::open(native.join("../samples/miko-qipao")).unwrap();
    assert_eq!(
        golden.grids.len(),
        1 + avatar.layers.layers.len() + avatar.sprites.as_ref().unwrap().layers.len()
    );
    for layer in golden.grids {
        let texture = &avatar.textures[&layer.texture];
        let actual = build_grid(
            layer.mesh.rect,
            layer.cell,
            &texture.alpha(),
            texture.width as usize,
            layer.fine.as_ref(),
        )
        .unwrap();
        assert_eq!(actual, layer.mesh, "grid mismatch for {}", layer.name);
    }
    for case in golden.cases {
        let actual = build_grid(
            case.rect,
            case.cell,
            &case.alpha,
            case.width,
            case.fine.as_ref(),
        )
        .unwrap();
        assert_eq!(actual, case.mesh, "grid mismatch for {}", case.name);
    }
}
