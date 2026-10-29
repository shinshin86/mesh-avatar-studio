use crate::{
    boundary::{Error, Result},
    types::*,
};
use mesh_avatar_core::{Avatar, Frame};
use std::{
    collections::BTreeMap,
    ffi::CString,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
};

fn ptr_or_null<T>(values: &[T]) -> *const T {
    if values.is_empty() {
        std::ptr::null()
    } else {
        values.as_ptr()
    }
}
pub(crate) struct CachedFrame {
    _frame: Frame,
    _names: Vec<CString>,
    layers: Vec<MaLayer>,
    uniforms: MaFaceUniforms,
}
// SAFETY: Every raw pointer in layers borrows an allocation owned by _frame/_names.
// Moving this cache never moves those allocations. All access is under the entry
// mutex; C callers must synchronize borrowed reads against tick/destroy.
unsafe impl Send for CachedFrame {}
impl CachedFrame {
    #[cfg(feature = "render")]
    pub fn frame(&self) -> &Frame {
        &self._frame
    }
    fn new(frame: Frame, ids: &BTreeMap<String, u32>) -> Result<Self> {
        let names: Vec<_> = frame
            .layers
            .iter()
            .map(|l| CString::new(l.name.as_str()))
            .collect::<std::result::Result<_, _>>()
            .map_err(|_| Error::new(MA_INVALID_STATE, "layer name contains NUL"))?;
        let layers = frame
            .layers
            .iter()
            .zip(&names)
            .map(|(layer, name)| {
                Ok(MaLayer {
                    name: name.as_ptr(),
                    texture_id: *ids
                        .get(&layer.texture)
                        .ok_or_else(|| Error::new(MA_INVALID_STATE, "missing texture id"))?,
                    positions: ptr_or_null(&layer.positions),
                    uvs: ptr_or_null(&layer.uvs),
                    vertex_count: layer.positions.len() / 2,
                    indices: ptr_or_null(&layer.indices),
                    index_count: layer.indices.len(),
                    rect: layer.rect,
                    alpha: layer.alpha,
                    face: u8::from(layer.face),
                    eye_ball: layer.eye_ball.map_or(-1, |i| i as i32),
                })
            })
            .collect::<Result<Vec<_>>>()?;
        let u = &frame.uniforms;
        let uniforms = MaFaceUniforms {
            angles: u.angles,
            eye_box: u.eye_box,
            eye_top: u.eye_top,
            eye_bot: u.eye_bot,
            eyes: u.eyes,
            mouth: u.mouth,
            mouth_state: u.mouth_state,
            cheeks: u.cheeks,
            cheek: u.cheek,
        };
        Ok(Self {
            _frame: frame,
            _names: names,
            layers,
            uniforms,
        })
    }
    pub fn descriptor(&self) -> MaFrame {
        MaFrame {
            layers: ptr_or_null(&self.layers),
            layer_count: self.layers.len(),
            uniforms: self.uniforms,
        }
    }
}
pub(crate) struct Entry {
    pub avatar: Avatar,
    pub frame: Option<CachedFrame>,
    pub poisoned: bool,
    alive: bool,
    names: Vec<CString>,
    ids: BTreeMap<String, u32>,
}
impl Entry {
    pub fn new(avatar: Avatar) -> Result<Self> {
        let names = avatar
            .textures()
            .keys()
            .map(|s| CString::new(s.as_str()))
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|_| Error::new(MA_LOAD_ERROR, "texture name contains NUL"))?;
        let ids = avatar
            .textures()
            .keys()
            .enumerate()
            .map(|(i, n)| (n.clone(), i as u32))
            .collect();
        let mut entry = Self {
            avatar,
            frame: None,
            poisoned: false,
            alive: true,
            names,
            ids,
        };
        entry.tick(0.0)?;
        Ok(entry)
    }
    pub fn tick(&mut self, dt: f64) -> Result<()> {
        self.frame = None; // Invalidate borrowed frame pointers before changing core state.
        let frame = self.avatar.tick(dt);
        self.frame = Some(CachedFrame::new(frame, &self.ids)?);
        Ok(())
    }
    pub fn texture_count(&self) -> usize {
        self.names.len()
    }
    pub fn texture(&self, index: usize) -> Result<MaTexture> {
        let (name, texture) = self
            .avatar
            .textures()
            .iter()
            .nth(index)
            .ok_or_else(|| Error::new(MA_OUT_OF_RANGE, "texture index is out of range"))?;
        Ok(MaTexture {
            id: self.ids[name],
            name: self.names[index].as_ptr(),
            width: texture.width,
            height: texture.height,
            rgba: ptr_or_null(&texture.rgba),
            byte_count: texture.rgba.len(),
        })
    }
}
type Entries = BTreeMap<MaHandle, Arc<Mutex<Entry>>>;
static ENTRIES: OnceLock<Mutex<Entries>> = OnceLock::new();
fn entries() -> &'static Mutex<Entries> {
    ENTRIES.get_or_init(|| Mutex::new(BTreeMap::new()))
}
static NEXT: AtomicU64 = AtomicU64::new(1);
pub(crate) fn insert(entry: Entry) -> Result<MaHandle> {
    let id = allocate_handle()?;
    entries()
        .lock()
        .map_err(|_| Error::new(MA_INVALID_STATE, "handle registry is poisoned"))?
        .insert(id, Arc::new(Mutex::new(entry)));
    Ok(id)
}
pub(crate) fn allocate_handle() -> Result<MaHandle> {
    let mut current = NEXT.load(Ordering::Relaxed);
    loop {
        let next = current
            .checked_add(1)
            .ok_or_else(|| Error::new(MA_INVALID_STATE, "handle space exhausted"))?;
        match NEXT.compare_exchange_weak(current, next, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(previous) => return Ok(previous),
            Err(actual) => current = actual,
        }
    }
}
pub(crate) fn with_entry<T>(
    handle: MaHandle,
    work: impl FnOnce(&mut Entry) -> Result<T>,
) -> Result<T> {
    let shared = entries()
        .lock()
        .map_err(|_| Error::new(MA_INVALID_STATE, "handle registry is poisoned"))?
        .get(&handle)
        .cloned()
        .ok_or_else(|| Error::new(MA_INVALID_HANDLE, "invalid or destroyed handle"))?;
    let mut entry = shared.lock().map_err(|_| {
        Error::new(
            MA_INVALID_STATE,
            "handle was poisoned by a panic; destroy and reopen it",
        )
    })?;
    if !entry.alive {
        return Err(Error::new(MA_INVALID_HANDLE, "destroyed handle"));
    }
    if entry.poisoned {
        return Err(Error::new(
            MA_INVALID_STATE,
            "handle was poisoned by a panic; destroy and reopen it",
        ));
    }
    entry.poisoned = true;
    let result = work(&mut entry);
    entry.poisoned = false;
    result
}
pub(crate) fn destroy(handle: MaHandle) -> Result<()> {
    let shared = entries()
        .lock()
        .map_err(|_| Error::new(MA_INVALID_STATE, "handle registry is poisoned"))?
        .remove(&handle)
        .ok_or_else(|| Error::new(MA_INVALID_HANDLE, "invalid or destroyed handle"))?;
    // Destruction must remain available after a contained panic.
    let mut entry = shared
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    entry.alive = false;
    entry.frame = None;
    Ok(())
}
