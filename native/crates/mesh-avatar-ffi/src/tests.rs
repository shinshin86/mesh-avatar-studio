use super::*;
use std::{
    ffi::{CStr, CString},
    fs,
    io::Write,
    mem::MaybeUninit,
    path::{Path, PathBuf},
    ptr,
};

fn sample() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../samples/miko-qipao")
}
fn open() -> MaHandle {
    let path = CString::new(sample().to_str().unwrap()).unwrap();
    let mut handle = 0;
    // SAFETY: Valid strings and writable local output slots throughout these tests.
    assert_eq!(
        unsafe { mesh_avatar_open_path(path.as_ptr(), &mut handle) },
        MA_OK
    );
    assert_ne!(handle, 0);
    handle
}
fn frame(handle: MaHandle) -> MaFrame {
    let mut out = MaybeUninit::uninit();
    assert_eq!(
        unsafe { mesh_avatar_get_frame(handle, out.as_mut_ptr()) },
        MA_OK
    );
    unsafe { out.assume_init() }
}
fn texture(handle: MaHandle, index: usize) -> MaTexture {
    let mut out = MaybeUninit::uninit();
    assert_eq!(
        unsafe { mesh_avatar_get_texture(handle, index, out.as_mut_ptr()) },
        MA_OK
    );
    unsafe { out.assume_init() }
}
fn error() -> String {
    unsafe { CStr::from_ptr(mesh_avatar_last_error()) }
        .to_str()
        .unwrap()
        .to_string()
}

#[test]
fn nulls_invalid_tokens_utf8_lengths_and_indices_are_checked() {
    let h = open();
    let mut out = 99;
    assert_eq!(
        unsafe { mesh_avatar_open_path(ptr::null(), &mut out) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(out, 0);
    assert_eq!(
        unsafe { mesh_avatar_open_path(c"missing".as_ptr(), ptr::null_mut()) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_open_bytes(ptr::null(), 1, &mut out) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_open_bytes(ptr::without_provenance(1), usize::MAX, &mut out) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(mesh_avatar_tick(0, 0.0), MA_INVALID_HANDLE);
    assert_eq!(mesh_avatar_destroy(u64::MAX), MA_INVALID_HANDLE);
    // Invalid handles are rejected without ever following a forged input string pointer.
    assert_eq!(
        unsafe { mesh_avatar_set_expression(0, ptr::without_provenance(1)) },
        MA_INVALID_HANDLE
    );
    assert_eq!(
        unsafe { mesh_avatar_set_overlays(0, ptr::without_provenance(1), 1) },
        MA_INVALID_HANDLE
    );
    assert_eq!(
        unsafe { mesh_avatar_set_overlays(h, ptr::null(), 1) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_set_overlays(h, ptr::without_provenance(1), 1) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_set_overlays(h, ptr::without_provenance(1), usize::MAX) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_set_overlays(h, ptr::null(), 0) },
        MA_OK
    );
    assert_eq!(
        unsafe { mesh_avatar_get_frame(h, ptr::null_mut()) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_get_frame(h, ptr::without_provenance_mut(1)) },
        MA_INVALID_ARGUMENT
    );
    let invalid = [0xff_u8, 0];
    assert_eq!(
        unsafe { mesh_avatar_set_expression(h, invalid.as_ptr().cast()) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_set_expression(h, ptr::null()) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_set_parameters(h, ptr::null(), 1, 1.0) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_set_parameters(h, ptr::without_provenance(1), 1, 1.0) },
        MA_INVALID_ARGUMENT
    );
    let mut layer = MaybeUninit::uninit();
    let mut tex = MaybeUninit::uninit();
    assert_eq!(
        unsafe { mesh_avatar_get_layer(h, usize::MAX, layer.as_mut_ptr()) },
        MA_OUT_OF_RANGE
    );
    assert_eq!(
        unsafe { mesh_avatar_get_texture(h, usize::MAX, tex.as_mut_ptr()) },
        MA_OUT_OF_RANGE
    );
    assert_eq!(mesh_avatar_tick(h, f64::NAN), MA_INVALID_ARGUMENT);
    assert_eq!(mesh_avatar_tick(h, -1.0), MA_INVALID_ARGUMENT);
    assert_eq!(
        mesh_avatar_set_voice_level(h, f64::INFINITY),
        MA_INVALID_ARGUMENT
    );
    assert_eq!(mesh_avatar_set_speaking(h, 2), MA_INVALID_ARGUMENT);
    assert_eq!(mesh_avatar_set_auto_idle(h, 2), MA_INVALID_ARGUMENT);
    assert_eq!(
        unsafe { mesh_avatar_play(h, c"unknown".as_ptr()) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_set_emotion(h, c"unknown".as_ptr(), 0) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_speak_kana(h, c"あ".as_ptr(), f64::NAN, 0) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_hold_mouth(h, c"unknown".as_ptr()) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(mesh_avatar_tick(h, 0.01), MA_OK);
    assert!(error().is_empty());
    assert_eq!(mesh_avatar_destroy(h), MA_OK);
    assert_eq!(mesh_avatar_destroy(h), MA_INVALID_HANDLE);
    assert_eq!(mesh_avatar_tick(h, 0.01), MA_INVALID_HANDLE);
    let next = open();
    assert_ne!(h, next);
    mesh_avatar_destroy(next);
}

#[test]
fn frame_geometry_uniforms_and_textures_match_core_with_explicit_lifetimes() {
    let h = open();
    let mut core = Avatar::open(sample()).unwrap();
    core.tick(0.0);
    let before = frame(h);
    let texture = texture(h, 0);
    let pixel_copy =
        unsafe { std::slice::from_raw_parts(texture.rgba, texture.byte_count) }.to_vec();
    assert_eq!(
        unsafe {
            mesh_avatar_set_parameters(
                h,
                [MaParameter {
                    name: c"angleX".as_ptr(),
                    value: 20.0,
                }]
                .as_ptr(),
                1,
                1.0,
            )
        },
        MA_OK
    );
    assert_eq!(frame(h).layers, before.layers); // A setter does not replace the cached frame.
    core.set_parameters(BTreeMap::from([("angleX".into(), 20.0)]));
    assert_eq!(mesh_avatar_tick(h, 0.016), MA_OK);
    let actual = frame(h);
    let expected = core.tick(0.016);
    assert_eq!(actual.layer_count, expected.layers.len());
    let layers = unsafe { std::slice::from_raw_parts(actual.layers, actual.layer_count) };
    for (a, b) in layers.iter().zip(&expected.layers) {
        assert_eq!(unsafe { CStr::from_ptr(a.name) }.to_str().unwrap(), b.name);
        if a.vertex_count > 0 {
            assert_eq!(
                unsafe { std::slice::from_raw_parts(a.positions, a.vertex_count * 2) },
                b.positions
            );
            assert_eq!(
                unsafe { std::slice::from_raw_parts(a.uvs, a.vertex_count * 2) },
                b.uvs
            );
        } else {
            assert!(b.positions.is_empty() && b.uvs.is_empty());
        }
        if a.index_count > 0 {
            assert_eq!(
                unsafe { std::slice::from_raw_parts(a.indices, a.index_count) },
                b.indices
            );
        }
        assert_eq!(a.alpha, b.alpha);
        assert_eq!(a.eye_ball, b.eye_ball.map_or(-1, |i| i as i32));
        assert_eq!(a.face, u8::from(b.face));
    }
    assert_eq!(actual.uniforms.angles, expected.uniforms.angles);
    assert_eq!(actual.uniforms.eye_top, expected.uniforms.eye_top);
    assert_eq!(actual.uniforms.mouth_state, expected.uniforms.mouth_state);
    // Texture storage is immutable across ticks, unlike cached frame storage.
    assert_eq!(
        unsafe { std::slice::from_raw_parts(texture.rgba, texture.byte_count) },
        pixel_copy
    );
    assert_eq!(texture.rgba, super::tests::texture(h, 0).rgba);
    assert_eq!(
        unsafe { mesh_avatar_set_parameters(h, ptr::null(), 0, 1.0) },
        MA_OK,
        "{}",
        error()
    );
    assert_eq!(
        unsafe { mesh_avatar_set_expression(h, c"wink".as_ptr()) },
        MA_OK
    );
    assert_eq!(
        unsafe { mesh_avatar_set_emotion(h, c"happy".as_ptr(), 1) },
        MA_OK
    );
    assert_eq!(unsafe { mesh_avatar_play(h, c"nod".as_ptr()) }, MA_OK);
    assert_eq!(mesh_avatar_set_voice_level(h, 0.7), MA_OK);
    assert_eq!(mesh_avatar_set_speaking(h, 1), MA_OK);
    assert_eq!(
        unsafe { mesh_avatar_speak_kana(h, c"こんにちは".as_ptr(), 7.0, 0) },
        MA_OK
    );
    assert_eq!(unsafe { mesh_avatar_hold_mouth(h, c"a".as_ptr()) }, MA_OK);
    assert_eq!(mesh_avatar_stop_lip_sync(h), MA_OK);
    assert_eq!(mesh_avatar_set_auto_idle(h, 0), MA_OK);
    assert_eq!(mesh_avatar_set_auto_motion(h, 0), MA_OK);
    assert_eq!(mesh_avatar_tick(h, 0.01), MA_OK);
    assert_eq!(mesh_avatar_destroy(h), MA_OK);
}

fn archive_bytes() -> Vec<u8> {
    let source = sample();
    let package = AvatarPackage::open(&source).unwrap();
    let mut manifest = serde_json::to_value(&package.manifest).unwrap();
    manifest
        .as_object_mut()
        .unwrap()
        .retain(|_, value| !value.is_null());
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, bytes) in [
        ("avatar.json", serde_json::to_vec(&manifest).unwrap()),
        ("rig.json", serde_json::to_vec(&package.rig).unwrap()),
        (
            "built/layers.json",
            serde_json::to_vec(&package.layers).unwrap(),
        ),
    ] {
        zip.start_file(name, options).unwrap();
        zip.write_all(&bytes).unwrap();
    }
    if let Some(sprites) = &package.sprites {
        zip.start_file("built/sprites.json", options).unwrap();
        zip.write_all(&serde_json::to_vec(sprites).unwrap())
            .unwrap();
    }
    for name in package.textures.keys() {
        let path = format!("built/{name}");
        zip.start_file(&path, options).unwrap();
        zip.write_all(&fs::read(source.join(path)).unwrap())
            .unwrap();
    }
    zip.finish().unwrap().into_inner()
}
#[test]
fn archive_input_is_consumed_without_retaining_the_caller_buffer() {
    let bytes = archive_bytes();
    let mut h = 0;
    assert_eq!(
        unsafe { mesh_avatar_open_bytes(bytes.as_ptr(), bytes.len(), &mut h) },
        MA_OK,
        "{}",
        error()
    );
    drop(bytes);
    assert_eq!(mesh_avatar_tick(h, 0.01), MA_OK);
    assert!(!texture(h, 0).rgba.is_null());
    mesh_avatar_destroy(h);
    assert_eq!(
        unsafe { mesh_avatar_open_bytes(b"bad".as_ptr(), 3, &mut h) },
        MA_LOAD_ERROR
    );
    assert_eq!(h, 0);
}

#[test]
fn overlay_selection_is_atomic_and_applies_on_the_next_tick() {
    use mesh_avatar_core::format::{OverlayDefinition, OverlayMetadata, Texture};
    let mut package = AvatarPackage::open(sample()).unwrap();
    let (width, height) = (package.rig.image.width, package.rig.image.height);
    let mut image = Texture {
        width,
        height,
        rgba: vec![0; (width * height * 4) as usize],
    };
    let i = ((height / 3 * width + width / 3) * 4) as usize;
    image.rgba[i..i + 4].copy_from_slice(&[80, 110, 140, 255]);
    package.textures.insert("overlays/frame.png".into(), image);
    package.overlays = Some(OverlayMetadata {
        version: 1,
        overlays: vec![OverlayDefinition {
            name: "glasses".into(),
            file: "frame.png".into(),
        }],
    });
    let avatar = Avatar::from_package(package).unwrap();
    let h = state::insert(state::Entry::new(avatar).map_err(|e| e.message).unwrap())
        .map_err(|e| e.message)
        .unwrap();
    let before = frame(h);
    let names = [
        c"glasses".as_ptr(),
        c"unknown".as_ptr(),
        c"glasses".as_ptr(),
    ];
    assert_eq!(
        unsafe { mesh_avatar_set_overlays(h, names.as_ptr(), names.len()) },
        MA_OK
    );
    assert_eq!(frame(h).layers, before.layers);
    let invalid = [0xff_u8, 0];
    for bad in [ptr::null(), invalid.as_ptr().cast()] {
        let names = [c"unknown".as_ptr(), bad];
        assert_eq!(
            unsafe { mesh_avatar_set_overlays(h, names.as_ptr(), names.len()) },
            MA_INVALID_ARGUMENT
        );
    }
    assert_eq!(mesh_avatar_tick(h, 0.0), MA_OK);
    assert_eq!(frame(h).layer_count, before.layer_count + 1);
    let shown = frame(h);
    let layers = unsafe { std::slice::from_raw_parts(shown.layers, shown.layer_count) };
    let overlay = layers
        .iter()
        .find(|layer| unsafe { CStr::from_ptr(layer.name) } == c"overlay_glasses")
        .unwrap();
    let image = texture(h, overlay.texture_id as usize);
    assert_eq!((image.width, image.height), (13, 13));
    assert_eq!(
        unsafe { mesh_avatar_set_overlays(h, ptr::null(), 0) },
        MA_OK
    );
    assert_eq!(frame(h).layer_count, shown.layer_count);
    assert_eq!(mesh_avatar_tick(h, 0.0), MA_OK);
    assert_eq!(frame(h).layer_count, before.layer_count);
    assert_eq!(mesh_avatar_destroy(h), MA_OK);
}

#[test]
fn handles_migrate_and_serialize_across_threads_and_destroy_can_race_calls() {
    fn assert_send<T: Send>() {}
    assert_send::<Avatar>();
    let h = open();
    let workers: Vec<_> = (0..4)
        .map(|_| {
            std::thread::spawn(move || {
                for _ in 0..10 {
                    assert_eq!(mesh_avatar_tick(h, 0.001), MA_OK);
                    // Only read copied metadata here; another thread may invalidate nested pointers.
                    assert!(frame(h).layer_count > 0);
                }
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap();
    }
    let reader = std::thread::spawn(move || {
        for _ in 0..100 {
            let status = mesh_avatar_tick(h, 0.001);
            assert!([MA_OK, MA_INVALID_HANDLE].contains(&status));
        }
    });
    assert_eq!(
        std::thread::spawn(move || mesh_avatar_destroy(h))
            .join()
            .unwrap(),
        MA_OK
    );
    reader.join().unwrap();
    assert_eq!(mesh_avatar_tick(h, 0.0), MA_INVALID_HANDLE);
}

#[test]
fn panics_are_contained_per_handle_and_errors_are_thread_local() {
    assert_eq!(mesh_avatar_abi_version(), 1);
    assert!(!unsafe { CStr::from_ptr(mesh_avatar_version()) }
        .to_bytes()
        .is_empty());
    let h = open();
    let other = open();
    assert_eq!(
        boundary(|| state::with_entry(h, |_| panic!("injected core panic"))),
        MA_PANIC
    );
    assert!(error().contains("injected core panic"));
    assert_eq!(std::thread::spawn(error).join().unwrap(), "");
    assert_eq!(mesh_avatar_tick(h, 0.0), MA_INVALID_STATE);
    assert_eq!(mesh_avatar_tick(other, 0.0), MA_OK);
    assert_eq!(mesh_avatar_destroy(h), MA_OK);
    assert_eq!(mesh_avatar_destroy(other), MA_OK);
}
