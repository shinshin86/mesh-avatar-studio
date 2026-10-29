use crate::types::*;
use std::{
    cell::RefCell,
    ffi::{c_char, CStr, CString},
    mem::{align_of, size_of},
    panic::{catch_unwind, AssertUnwindSafe},
};

pub(crate) struct Error {
    pub code: MaStatus,
    pub message: String,
}
pub(crate) type Result<T> = std::result::Result<T, Error>;
impl Error {
    pub fn new(code: MaStatus, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}
thread_local! { static LAST_ERROR:RefCell<CString> = RefCell::new(CString::default()); }
fn error_text(message: &str) {
    // Error reporting itself must not propagate a second Rust panic through C.
    let _ = catch_unwind(AssertUnwindSafe(|| {
        LAST_ERROR.with(|slot| {
            if let Ok(mut slot) = slot.try_borrow_mut() {
                if let Ok(text) = CString::new(message.replace('\0', "�")) {
                    *slot = text;
                }
            }
        })
    }));
}
pub(crate) fn boundary(work: impl FnOnce() -> Result<()>) -> MaStatus {
    match catch_unwind(AssertUnwindSafe(|| {
        error_text("");
        work()
    })) {
        Ok(Ok(())) => MA_OK,
        Ok(Err(error)) => {
            error_text(&error.message);
            error.code
        }
        Err(payload) => {
            let message = payload
                .downcast_ref::<String>()
                .map(String::as_str)
                .or_else(|| payload.downcast_ref::<&str>().copied())
                .unwrap_or("Rust panic");
            error_text(message);
            MA_PANIC
        }
    }
}
pub(crate) fn last_error() -> *const c_char {
    catch_unwind(AssertUnwindSafe(|| {
        LAST_ERROR.with(|slot| {
            slot.try_borrow()
                .map(|s| s.as_ptr())
                .unwrap_or(c"Error text is busy".as_ptr())
        })
    }))
    .unwrap_or(c"Error text unavailable".as_ptr())
}
pub(crate) fn check_out<T>(out: *mut T) -> Result<()> {
    if out.is_null() || !(out as usize).is_multiple_of(align_of::<T>()) {
        Err(Error::new(
            MA_INVALID_ARGUMENT,
            "output pointer is NULL or misaligned",
        ))
    } else {
        Ok(())
    }
}
/// Caller must provide readable, aligned memory for count elements, unless count is zero.
pub(crate) unsafe fn input_slice<'a, T>(data: *const T, count: usize) -> Result<&'a [T]> {
    if count == 0 {
        return Ok(&[]);
    }
    if data.is_null()
        || !(data as usize).is_multiple_of(align_of::<T>())
        || count > isize::MAX as usize / size_of::<T>().max(1)
    {
        return Err(Error::new(
            MA_INVALID_ARGUMENT,
            "input pointer is NULL/misaligned or length overflows",
        ));
    }
    // SAFETY: The ABI caller guarantees readable memory after the shape checks above.
    Ok(unsafe { std::slice::from_raw_parts(data, count) })
}
/// Caller must provide a readable NUL-terminated string when non-NULL.
pub(crate) unsafe fn input_str<'a>(text: *const c_char) -> Result<&'a str> {
    if text.is_null() {
        return Err(Error::new(MA_INVALID_ARGUMENT, "string pointer is NULL"));
    }
    // SAFETY: The ABI caller guarantees a readable NUL-terminated string.
    unsafe { CStr::from_ptr(text) }
        .to_str()
        .map_err(|_| Error::new(MA_INVALID_ARGUMENT, "string must be UTF-8"))
}
pub(crate) fn flag(value: u8) -> Result<bool> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(Error::new(MA_INVALID_ARGUMENT, "boolean must be 0 or 1")),
    }
}
