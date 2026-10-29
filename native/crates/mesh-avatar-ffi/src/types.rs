use std::ffi::c_char;

/// Opaque process-wide token. Zero is invalid. Never cast to a pointer or free it.
pub type MaHandle = u64;
pub type MaStatus = i32;
pub const MA_OK: MaStatus = 0;
pub const MA_INVALID_ARGUMENT: MaStatus = 1;
pub const MA_INVALID_HANDLE: MaStatus = 2;
pub const MA_LOAD_ERROR: MaStatus = 3;
pub const MA_OUT_OF_RANGE: MaStatus = 4;
pub const MA_INVALID_STATE: MaStatus = 5;
pub const MA_PANIC: MaStatus = 6;

/// A UTF-8, NUL-terminated parameter name and finite value. Input is copied.
#[repr(C)]
pub struct MaParameter {
    pub name: *const c_char,
    pub value: f64,
}

/// Copied FaceUniforms fields in C layout, not a GPU uniform-buffer layout.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct MaFaceUniforms {
    pub angles: [f32; 3],
    pub eye_box: [[f32; 4]; 2],
    pub eye_top: [[f32; 24]; 2],
    pub eye_bot: [[f32; 24]; 2],
    pub eyes: [f32; 8],
    pub mouth: [f32; 4],
    pub mouth_state: [f32; 4],
    pub cheeks: [f32; 4],
    pub cheek: f32,
}

/// Borrowed geometry. All pointers (including name) expire at next tick/destroy.
/// positions and uvs contain vertex_count * 2 floats in x,y / u,v order.
/// indices contains index_count uint32 values in triangle order; empty arrays are NULL.
/// Positions use source-image pixels with a top-left origin; UVs address the layer texture.
/// rect is [x, y, width, height] in source-image pixels.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MaLayer {
    pub name: *const c_char,
    pub texture_id: u32,
    pub positions: *const f32,
    pub uvs: *const f32,
    pub vertex_count: usize,
    pub indices: *const u32,
    pub index_count: usize,
    pub rect: [f64; 4],
    pub alpha: f64,
    /// 1 for a face layer, otherwise 0.
    pub face: u8,
    /// -1 for no eye-ball shader, 0 or 1 for the corresponding eye.
    pub eye_ball: i32,
}

/// Copied descriptor with borrowed layers. layers points to layer_count MaLayer values.
/// The descriptors and nested pointers expire at next tick/destroy; do not free them.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MaFrame {
    pub layers: *const MaLayer,
    pub layer_count: usize,
    pub uniforms: MaFaceUniforms,
}

/// Borrowed immutable texture. name and rgba remain valid until destroy.
/// RGBA is straight (not premultiplied) RGBA8, top-left origin, tightly packed.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MaTexture {
    pub id: u32,
    pub name: *const c_char,
    pub width: u32,
    pub height: u32,
    pub rgba: *const u8,
    pub byte_count: usize,
}

/// Copied dimensions and viewport padding for a host renderer.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct MaAvatarInfo {
    pub image_width: u32,
    pub image_height: u32,
    pub pad_top: f64,
    pub pad_side: f64,
}
