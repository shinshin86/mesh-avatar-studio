use super::*;
use crate::{mesh_avatar_destroy, mesh_avatar_get_frame, mesh_avatar_open_path, mesh_avatar_tick};
use std::{ffi::CString, mem::MaybeUninit, path::Path, ptr};

fn avatar() -> MaHandle {
    let path = CString::new(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../samples/miko-qipao")
            .to_str()
            .unwrap(),
    )
    .unwrap();
    let mut out = 0;
    assert_eq!(
        unsafe { mesh_avatar_open_path(path.as_ptr(), &mut out) },
        MA_OK
    );
    out
}
fn options() -> MaRenderOptions {
    MaRenderOptions {
        width: 65,
        height: 80,
        samples: 1,
        fit: MA_FIT_CONTAIN,
        pad_top: 0.15,
        pad_side: 0.1,
    }
}
fn create(avatar: MaHandle, options: &MaRenderOptions) -> Option<MaRenderer> {
    let mut out = 0;
    let status = unsafe { mesh_avatar_renderer_create(avatar, options, &mut out) };
    if status == MA_GPU_UNAVAILABLE {
        assert_eq!(out, 0);
        eprintln!("No compatible GPU adapter; skipping renderer readback test.");
        return None;
    }
    assert_eq!(status, MA_OK);
    assert_ne!(out, 0);
    Some(out)
}

#[test]
fn invalid_tokens_options_sizes_and_layout_are_checked_before_gpu_use() {
    assert_eq!(mesh_avatar_renderer_destroy(0), MA_INVALID_HANDLE);
    assert_eq!(
        mesh_avatar_renderer_resize(u64::MAX, 1, 1),
        MA_INVALID_HANDLE
    );
    assert_eq!(
        unsafe { mesh_avatar_renderer_render(0, ptr::null_mut(), 0, 0) },
        MA_INVALID_HANDLE
    );
    let mut out = 99;
    assert_eq!(
        unsafe { mesh_avatar_renderer_create(0, ptr::null(), &mut out) },
        MA_INVALID_HANDLE
    );
    assert_eq!(out, 0);
    let h = avatar();
    assert_eq!(
        unsafe { mesh_avatar_renderer_create(h, &options(), ptr::null_mut()) },
        MA_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { mesh_avatar_renderer_create(h, ptr::null(), &mut out) },
        MA_INVALID_ARGUMENT
    );
    let misaligned = ptr::dangling::<u8>().cast::<MaRenderOptions>();
    assert_eq!(
        unsafe { mesh_avatar_renderer_create(h, misaligned, &mut out) },
        MA_INVALID_ARGUMENT
    );
    for bad in [
        MaRenderOptions {
            width: 0,
            ..options()
        },
        MaRenderOptions {
            width: u32::MAX,
            height: u32::MAX,
            ..options()
        },
        MaRenderOptions {
            samples: 2,
            ..options()
        },
        MaRenderOptions {
            fit: 123,
            ..options()
        },
        MaRenderOptions {
            pad_top: f64::NAN,
            ..options()
        },
        MaRenderOptions {
            pad_top: -1.0,
            ..options()
        },
        MaRenderOptions {
            pad_side: -0.5,
            ..options()
        },
    ] {
        assert_eq!(
            unsafe { mesh_avatar_renderer_create(h, &bad, &mut out) },
            MA_INVALID_ARGUMENT
        );
        assert_eq!(out, 0);
    }
    assert_eq!(
        rgba_length([u32::MAX, 2]).err().unwrap().code,
        MA_INVALID_ARGUMENT
    );
    let limits = wgpu::Limits::default();
    let view = ViewOptions {
        image_size: [100, 100],
        pad_top: 0.0,
        pad_side: 0.0,
        fit: Fit::Contain,
    };
    assert!(validate_target([limits.max_texture_dimension_2d + 1, 1], &view, &limits).is_err());
    assert!(validate_target(
        [8192, 8192],
        &view,
        &wgpu::Limits {
            max_buffer_size: 100,
            ..limits
        }
    )
    .is_err());
    assert_eq!(mesh_avatar_destroy(h), MA_OK);
}

#[test]
fn readback_preserves_cache_checks_buffers_and_handles_resize_and_both_alpha_modes() {
    let h = avatar();
    let Some(r) = create(h, &options()) else {
        mesh_avatar_destroy(h);
        return;
    };
    let mut before = MaybeUninit::<MaFrame>::uninit();
    assert_eq!(
        unsafe { mesh_avatar_get_frame(h, before.as_mut_ptr()) },
        MA_OK
    );
    let before = unsafe { before.assume_init() };
    let needed = 65 * 80 * 4;
    let mut straight = vec![77_u8; needed + 8];
    for (buffer, length, mode) in [
        (ptr::null_mut(), needed, MA_RGBA_STRAIGHT),
        (straight.as_mut_ptr(), needed - 1, MA_RGBA_STRAIGHT),
        (straight.as_mut_ptr(), usize::MAX, MA_RGBA_STRAIGHT),
        (straight.as_mut_ptr(), needed, 99),
    ] {
        assert_eq!(
            unsafe { mesh_avatar_renderer_render(r, buffer, length, mode) },
            MA_INVALID_ARGUMENT
        );
    }
    assert!(straight.iter().all(|&v| v == 77));
    assert_eq!(
        unsafe {
            mesh_avatar_renderer_render(r, straight.as_mut_ptr(), straight.len(), MA_RGBA_STRAIGHT)
        },
        MA_OK
    );
    assert_eq!(&straight[needed..], &[77; 8]);
    let mut premultiplied = vec![0; needed];
    assert_eq!(
        unsafe {
            mesh_avatar_renderer_render(
                r,
                premultiplied.as_mut_ptr(),
                needed,
                MA_RGBA_PREMULTIPLIED,
            )
        },
        MA_OK
    );
    assert!(straight[..needed]
        .as_chunks::<4>()
        .0
        .iter()
        .any(|p| p[3] == 0));
    assert!(straight[..needed]
        .as_chunks::<4>()
        .0
        .iter()
        .any(|p| p[3] > 0));
    for (s, p) in straight[..needed]
        .as_chunks::<4>()
        .0
        .iter()
        .zip(premultiplied.as_chunks::<4>().0.iter())
    {
        assert_eq!(s[3], p[3]);
        for c in 0..3 {
            let expected = ((u32::from(s[c]) * u32::from(s[3]) + 127) / 255) as u8;
            assert!(p[c].abs_diff(expected) <= 1);
        }
    }
    let mut after = MaybeUninit::<MaFrame>::uninit();
    assert_eq!(
        unsafe { mesh_avatar_get_frame(h, after.as_mut_ptr()) },
        MA_OK
    );
    assert_eq!(before.layers, unsafe { after.assume_init() }.layers);
    assert_eq!(mesh_avatar_renderer_resize(r, 0, 8), MA_INVALID_ARGUMENT);
    assert_eq!(
        mesh_avatar_renderer_resize(r, u32::MAX, 8),
        MA_INVALID_ARGUMENT
    );
    assert_eq!(mesh_avatar_renderer_resize(r, 33, 17), MA_OK);
    let moved = std::thread::spawn(move || {
        let mut bytes = vec![0; 33 * 17 * 4];
        assert_eq!(
            unsafe {
                mesh_avatar_renderer_render(r, bytes.as_mut_ptr(), bytes.len(), MA_RGBA_STRAIGHT)
            },
            MA_OK
        );
        assert!(bytes.as_chunks::<4>().0.iter().any(|p| p[3] != 0));
    });
    moved.join().unwrap();
    // Concurrent tick and render are synchronized without exposing borrowed pixels.
    let ticking = std::thread::spawn(move || {
        for _ in 0..20 {
            assert_eq!(mesh_avatar_tick(h, 0.01), MA_OK);
        }
    });
    let mut bytes = vec![0; 33 * 17 * 4];
    assert_eq!(
        unsafe {
            mesh_avatar_renderer_render(r, bytes.as_mut_ptr(), bytes.len(), MA_RGBA_STRAIGHT)
        },
        MA_OK
    );
    ticking.join().unwrap();
    assert_eq!(mesh_avatar_renderer_destroy(h), MA_INVALID_HANDLE);
    assert_eq!(mesh_avatar_destroy(r), MA_INVALID_HANDLE);
    assert_eq!(mesh_avatar_renderer_destroy(r), MA_OK);
    assert_eq!(mesh_avatar_renderer_destroy(r), MA_INVALID_HANDLE);
    assert_eq!(mesh_avatar_renderer_resize(r, 1, 1), MA_INVALID_HANDLE);
    assert_eq!(mesh_avatar_destroy(h), MA_OK);
}

#[test]
fn cover_msaa_destroyed_avatars_and_renderer_panics_are_contained() {
    let h = avatar();
    let Some(r) = create(
        h,
        &MaRenderOptions {
            fit: MA_FIT_COVER,
            samples: 4,
            ..options()
        },
    ) else {
        mesh_avatar_destroy(h);
        return;
    };
    let mut bytes = vec![0; 65 * 80 * 4];
    assert_eq!(
        unsafe {
            mesh_avatar_renderer_render(r, bytes.as_mut_ptr(), bytes.len(), MA_RGBA_STRAIGHT)
        },
        MA_OK
    );
    assert_eq!(
        boundary(|| with_renderer(r, |_| -> Result<()> { panic!("injected renderer panic") })),
        MA_PANIC
    );
    assert_eq!(mesh_avatar_renderer_resize(r, 16, 16), MA_INVALID_STATE);
    assert_eq!(mesh_avatar_tick(h, 0.0), MA_OK);
    assert_eq!(mesh_avatar_renderer_destroy(r), MA_OK);
    let r2 = create(h, &options()).unwrap();
    assert_ne!(r, r2);
    assert_eq!(mesh_avatar_destroy(h), MA_OK);
    bytes.fill(88);
    assert_eq!(
        unsafe {
            mesh_avatar_renderer_render(r2, bytes.as_mut_ptr(), bytes.len(), MA_RGBA_STRAIGHT)
        },
        MA_INVALID_HANDLE
    );
    assert!(bytes.iter().all(|&v| v == 88));
    assert_eq!(mesh_avatar_renderer_destroy(r2), MA_OK);
}
