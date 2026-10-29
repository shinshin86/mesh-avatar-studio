//! A C ABI over the CPU runtime. The checked-in header defines the ownership contract.
#![deny(unsafe_op_in_unsafe_fn)]
mod boundary;
#[cfg(feature = "render")]
pub mod render;
mod state;
mod types;
use boundary::{boundary, check_out, flag, input_slice, input_str, Error};
use mesh_avatar_core::{
    engine::{expression::OVERLAY_EXPRESSIONS, kana::Vowel, motion::SpeakOptions, rig::PARAMS},
    format::AvatarPackage,
    Avatar,
};
use std::{collections::BTreeMap, ffi::c_char, io::Cursor, panic::catch_unwind};
pub use types::*;

static VERSION: &[u8] = concat!(env!("CARGO_PKG_VERSION"), "\0").as_bytes();

/// Static UTF-8 version string. Borrowed for the lifetime of the loaded library.
#[no_mangle]
pub extern "C" fn mesh_avatar_version() -> *const c_char {
    catch_unwind(|| VERSION.as_ptr().cast()).unwrap_or(c"unknown".as_ptr())
}
/// ABI revision, currently 1. Zero indicates a contained failure.
#[no_mangle]
pub extern "C" fn mesh_avatar_abi_version() -> u32 {
    catch_unwind(|| 1).unwrap_or(0)
}
/// Thread-local UTF-8 error, valid until the next API call on this thread.
/// Calling this function again does not invalidate it. Never free this pointer.
#[no_mangle]
pub extern "C" fn mesh_avatar_last_error() -> *const c_char {
    boundary::last_error()
}

/// Open a .mavatar archive or built project folder and create its initial frame.
/// On failure, *out is zero. Inputs are copied; no caller buffer is retained.
/// # Safety
/// path must be a readable UTF-8 NUL-terminated string; out must be writable/aligned.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_open_path(
    path: *const c_char,
    out: *mut MaHandle,
) -> MaStatus {
    boundary(|| {
        check_out(out)?;
        // SAFETY: The caller supplies a writable output slot.
        unsafe { out.write(0) };
        // SAFETY: The caller supplies a readable C string; NULL is checked by input_str.
        let path = unsafe { input_str(path) }?;
        let avatar = Avatar::open(path).map_err(|e| Error::new(MA_LOAD_ERROR, format!("{e:#}")))?;
        let handle = state::insert(state::Entry::new(avatar)?)?;
        // SAFETY: Output slot was checked above and cannot alias library-owned storage.
        unsafe { out.write(handle) };
        Ok(())
    })
}
/// Open in-memory .mavatar ZIP bytes. Bytes need only remain valid during this call.
/// # Safety
/// bytes must be readable for length bytes (NULL allowed for zero length); out writable/aligned.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_open_bytes(
    bytes: *const u8,
    length: usize,
    out: *mut MaHandle,
) -> MaStatus {
    boundary(|| {
        check_out(out)?;
        // SAFETY: The caller supplies a writable output slot and readable input bytes.
        unsafe { out.write(0) };
        let bytes = unsafe { input_slice(bytes, length) }?;
        let package = AvatarPackage::from_archive(Cursor::new(bytes))
            .map_err(|e| Error::new(MA_LOAD_ERROR, format!("{e:#}")))?;
        let avatar = Avatar::from_package(package)
            .map_err(|e| Error::new(MA_LOAD_ERROR, format!("{e:#}")))?;
        let handle = state::insert(state::Entry::new(avatar)?)?;
        // SAFETY: Validated caller-owned output slot.
        unsafe { out.write(handle) };
        Ok(())
    })
}
/// Destroy a handle from any thread. Rejects zero, unknown and already destroyed tokens.
/// All pointers borrowed from this handle become invalid; callers must finish their reads first.
#[no_mangle]
pub extern "C" fn mesh_avatar_destroy(handle: MaHandle) -> MaStatus {
    boundary(|| state::destroy(handle))
}
/// Advance by nonnegative finite seconds (the core caps the step at 0.05).
/// Invalidates all prior frame/layer pointers. Setters alone leave the cached frame intact.
#[no_mangle]
pub extern "C" fn mesh_avatar_tick(handle: MaHandle, dt: f64) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            if !dt.is_finite() || dt < 0.0 {
                return Err(Error::new(
                    MA_INVALID_ARGUMENT,
                    "dt must be finite and nonnegative",
                ));
            }
            entry.tick(dt)
        })
    })
}
/// Copy the current frame descriptor; nested pointers remain library-owned.
/// # Safety
/// out must be writable/aligned and must not alias borrowed library memory.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_get_frame(handle: MaHandle, out: *mut MaFrame) -> MaStatus {
    boundary(|| {
        check_out(out)?;
        state::with_entry(handle, |entry| {
            let frame = entry
                .frame
                .as_ref()
                .ok_or_else(|| Error::new(MA_INVALID_STATE, "no current frame"))?;
            // SAFETY: Caller-owned output was checked; returned pointers borrow entry storage.
            unsafe { out.write(frame.descriptor()) };
            Ok(())
        })
    })
}
/// Copy one layer descriptor. index is zero-based; pointers expire on tick/destroy.
/// # Safety
/// out must be writable/aligned and must not alias borrowed library memory.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_get_layer(
    handle: MaHandle,
    index: usize,
    out: *mut MaLayer,
) -> MaStatus {
    boundary(|| {
        check_out(out)?;
        state::with_entry(handle, |entry| {
            let frame = entry
                .frame
                .as_ref()
                .ok_or_else(|| Error::new(MA_INVALID_STATE, "no current frame"))?
                .descriptor();
            if index >= frame.layer_count {
                return Err(Error::new(MA_OUT_OF_RANGE, "layer index is out of range"));
            }
            // SAFETY: The index was checked against the cached layer allocation.
            unsafe { out.write(frame.layers.add(index).read()) };
            Ok(())
        })
    })
}
/// Copy avatar dimensions and padding.
/// # Safety
/// out must be writable/aligned.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_get_info(
    handle: MaHandle,
    out: *mut MaAvatarInfo,
) -> MaStatus {
    boundary(|| {
        check_out(out)?;
        state::with_entry(handle, |entry| {
            let rig = &entry.avatar.package().rig;
            // SAFETY: Caller-owned output slot was checked above.
            unsafe {
                out.write(MaAvatarInfo {
                    image_width: rig.image.width,
                    image_height: rig.image.height,
                    pad_top: rig.view.pad_top,
                    pad_side: rig.view.pad_side,
                })
            };
            Ok(())
        })
    })
}
/// Copy texture count. IDs are zero-based indices and stable until destroy.
/// # Safety
/// out must be writable/aligned.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_texture_count(handle: MaHandle, out: *mut usize) -> MaStatus {
    boundary(|| {
        check_out(out)?;
        state::with_entry(handle, |entry| {
            // SAFETY: Caller-owned output slot was checked above.
            unsafe { out.write(entry.texture_count()) };
            Ok(())
        })
    })
}
/// Copy immutable straight-RGBA texture metadata; pointers expire only at destroy.
/// # Safety
/// out must be writable/aligned and must not alias borrowed library memory.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_get_texture(
    handle: MaHandle,
    index: usize,
    out: *mut MaTexture,
) -> MaStatus {
    boundary(|| {
        check_out(out)?;
        state::with_entry(handle, |entry| {
            let texture = entry.texture(index)?;
            // SAFETY: Caller-owned output slot was checked above.
            unsafe { out.write(texture) };
            Ok(())
        })
    })
}
/// Replace all parameter overrides. NULL with count=0 clears them. weight must be in [0,1].
/// Names/values are copied; supported names/ranges follow the core PARAMS plus eyeSmileL [0,1].
/// At most 128 entries; duplicate names use the last value. Unknown/out-of-range values fail.
/// # Safety
/// values must be readable/aligned for count entries and each name a readable UTF-8 C string.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_set_parameters(
    handle: MaHandle,
    values: *const MaParameter,
    count: usize,
    weight: f64,
) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            if count > 128 || !weight.is_finite() || !(0.0..=1.0).contains(&weight) {
                return Err(Error::new(
                    MA_INVALID_ARGUMENT,
                    "invalid parameter count or weight",
                ));
            }
            // SAFETY: The caller supplies readable/aligned entries and C-string names.
            let values = unsafe { input_slice(values, count) }?;
            let mut parameters = BTreeMap::new();
            for parameter in values {
                let name = unsafe { input_str(parameter.name) }?;
                let range = PARAMS
                    .iter()
                    .find(|p| p.id == name)
                    .map(|p| (p.min, p.max))
                    .or_else(|| (name == "eyeSmileL").then_some((0.0, 1.0)))
                    .ok_or_else(|| {
                        Error::new(MA_INVALID_ARGUMENT, format!("unknown parameter: {name}"))
                    })?;
                if !parameter.value.is_finite() || !(range.0..=range.1).contains(&parameter.value) {
                    return Err(Error::new(
                        MA_INVALID_ARGUMENT,
                        format!("parameter out of range: {name}"),
                    ));
                }
                parameters.insert(name.to_string(), parameter.value);
            }
            entry.avatar.set_parameters_weighted(parameters, weight);
            Ok(())
        })
    })
}
/// Select a live expression: neutral, smile, shy, surprise, halfLidded, angry, sad or wink.
/// # Safety
/// name must be a readable UTF-8 NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_set_expression(
    handle: MaHandle,
    name: *const c_char,
) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            // SAFETY: Caller supplies a readable C string; NULL/UTF-8 are checked.
            let name = unsafe { input_str(name) }?;
            if !OVERLAY_EXPRESSIONS.iter().any(|(id, _)| *id == name) {
                return Err(Error::new(MA_INVALID_ARGUMENT, "unknown live expression"));
            }
            entry.avatar.set_expression(name);
            Ok(())
        })
    })
}
/// Show exactly the listed known overlays; unknown names are ignored. NULL with count=0 hides all.
/// At most 200 names. Strings are consumed during this call; the cached frame changes on tick.
/// Invalid input leaves the selection unchanged.
/// # Safety
/// names must be readable/aligned for count pointers, each a readable UTF-8 C string.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_set_overlays(
    handle: MaHandle,
    names: *const *const c_char,
    count: usize,
) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            if count > 200 {
                return Err(Error::new(MA_INVALID_ARGUMENT, "overlay count exceeds 200"));
            }
            // SAFETY: The caller provides readable pointers and NUL-terminated strings.
            let names = unsafe { input_slice(names, count) }?;
            let names = names
                .iter()
                .map(|&name| unsafe { input_str(name) })
                .collect::<boundary::Result<Vec<_>>>()?;
            entry.avatar.set_overlays(&names);
            Ok(())
        })
    })
}
/// Emotion tag: neutral, happy, sad, angry, surprised or relaxed. play_motion is 0 or 1.
/// # Safety
/// tag must be a readable UTF-8 NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_set_emotion(
    handle: MaHandle,
    tag: *const c_char,
    play_motion: u8,
) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            // SAFETY: Caller supplies a readable C string.
            let tag = unsafe { input_str(tag) }?;
            if !["neutral", "happy", "sad", "angry", "surprised", "relaxed"].contains(&tag) {
                return Err(Error::new(MA_INVALID_ARGUMENT, "unknown emotion"));
            }
            entry
                .avatar
                .set_emotion_with_motion(tag, flag(play_motion)?);
            Ok(())
        })
    })
}
/// Play a built-in motion by its ID, e.g. nod, no, sway or greet.
/// # Safety
/// id must be a readable UTF-8 NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_play(handle: MaHandle, id: *const c_char) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            // SAFETY: Caller supplies a readable C string.
            let id = unsafe { input_str(id) }?;
            if !entry.avatar.motions().iter().any(|m| m.id == id) {
                return Err(Error::new(MA_INVALID_ARGUMENT, "unknown motion"));
            }
            entry.avatar.play(id);
            Ok(())
        })
    })
}
/// Set normalized voice level in [0,1]; finite values only.
#[no_mangle]
pub extern "C" fn mesh_avatar_set_voice_level(handle: MaHandle, level: f64) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            if !level.is_finite() || !(0.0..=1.0).contains(&level) {
                return Err(Error::new(
                    MA_INVALID_ARGUMENT,
                    "voice level must be finite and in [0,1]",
                ));
            }
            entry.avatar.set_voice_level(level);
            Ok(())
        })
    })
}
/// Set speaking state: 0 or 1.
#[no_mangle]
pub extern "C" fn mesh_avatar_set_speaking(handle: MaHandle, on: u8) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            entry.avatar.set_speaking(flag(on)?);
            Ok(())
        })
    })
}
/// Run kana mouth shapes without audio. speed=0 uses the core default; otherwise mora/second,
/// clamped by the core to [4,12]. looping is 0 or 1.
/// # Safety
/// text must be a readable UTF-8 NUL-terminated string; it is copied during this call.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_speak_kana(
    handle: MaHandle,
    text: *const c_char,
    speed: f64,
    looping: u8,
) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            // SAFETY: Caller supplies a readable C string.
            let text = unsafe { input_str(text) }?;
            if !speed.is_finite() || speed < 0.0 {
                return Err(Error::new(
                    MA_INVALID_ARGUMENT,
                    "kana speed must be finite and nonnegative",
                ));
            }
            entry.avatar.speak_kana(
                text,
                SpeakOptions {
                    speed: (speed > 0.0).then_some(speed),
                    looping: flag(looping)?,
                },
            );
            Ok(())
        })
    })
}
/// Hold a mouth vowel: a, i, u, e, o or n.
/// # Safety
/// vowel must be a readable UTF-8 C string.
#[no_mangle]
pub unsafe extern "C" fn mesh_avatar_hold_mouth(
    handle: MaHandle,
    vowel: *const c_char,
) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            // SAFETY: Caller supplies a readable C string.
            let vowel = Vowel::parse(unsafe { input_str(vowel) }?)
                .ok_or_else(|| Error::new(MA_INVALID_ARGUMENT, "unknown vowel"))?;
            entry.avatar.hold_mouth(vowel);
            Ok(())
        })
    })
}
/// Stop kana and held-vowel lip sync.
#[no_mangle]
pub extern "C" fn mesh_avatar_stop_lip_sync(handle: MaHandle) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            entry.avatar.stop_lip_sync();
            Ok(())
        })
    })
}
/// Enable automatic idle: 0 or 1.
#[no_mangle]
pub extern "C" fn mesh_avatar_set_auto_idle(handle: MaHandle, on: u8) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            entry.avatar.set_auto_idle(flag(on)?);
            Ok(())
        })
    })
}
/// Enable automatic motion: 0 or 1.
#[no_mangle]
pub extern "C" fn mesh_avatar_set_auto_motion(handle: MaHandle, on: u8) -> MaStatus {
    boundary(|| {
        state::with_entry(handle, |entry| {
            entry.avatar.set_auto_motion(flag(on)?);
            Ok(())
        })
    })
}

#[cfg(test)]
mod tests;
