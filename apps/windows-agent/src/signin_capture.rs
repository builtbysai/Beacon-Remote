//! DXGI source for the separately authorized sign-in worker. Never falls back
//! to ordinary capture or duplicates a desktop from Session 0.
use crate::{
    signin_pixels::{self, Cursor, Rotation},
    signin_scope::SignInScope,
    HostError,
};
use beacon_remote_core::{Display, Snapshot};
use std::sync::Arc;
use windows::{
    core::Interface,
    Win32::{
        Foundation::HMODULE,
        Graphics::{
            Direct3D::{D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0},
            Direct3D11::*,
            Dxgi::{Common::*, *},
        },
    },
};
use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, MONITORINFO};
use zeroize::{Zeroize, Zeroizing};

pub(crate) const DISPLAY: &str = "signin-primary";

struct Primary {
    adapter: IDXGIAdapter1,
    output: IDXGIOutput,
    desc: DXGI_OUTPUT_DESC,
    rotation: Rotation,
}
// Enumeration only. Creating a duplication or acquiring pixels belongs solely
// to SignInCapture::start after the authenticated peer opens the media gate.
fn primary() -> Result<Primary, HostError> {
    let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1()? };
    for a in 0..32 {
        let adapter = match unsafe { factory.EnumAdapters1(a) } {
            Ok(adapter) => adapter,
            Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
            Err(error) => return Err(error.into()),
        };
        for o in 0..32 {
            let output = match unsafe { adapter.EnumOutputs(o) } {
                Ok(output) => output,
                Err(error) if error.code() == DXGI_ERROR_NOT_FOUND => break,
                Err(error) => return Err(error.into()),
            };
            let desc = unsafe { output.GetDesc()? };
            let mut monitor = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if !desc.AttachedToDesktop.as_bool()
                || unsafe { GetMonitorInfoW(desc.Monitor.0, &mut monitor) } == 0
                || monitor.dwFlags & 1 == 0
            {
                continue;
            }
            let rotation = Rotation::from_code(desc.Rotation.0)?;
            let _: IDXGIOutput1 = output.cast()?;
            return Ok(Primary {
                adapter,
                output,
                desc,
                rotation,
            });
        }
    }
    Err("No supported primary sign-in display is available".into())
}
pub(crate) fn preflight(console: u32) -> Result<(), HostError> {
    if !crate::signin_worker::on_signin_desktop(console) {
        return Err("The sign-in desktop changed during preflight".into());
    }
    let _primary = primary()?;
    if !crate::signin_worker::on_signin_desktop(console) {
        return Err("The sign-in desktop changed during preflight".into());
    }
    Ok(())
}

struct Acquired {
    duplication: Option<IDXGIOutputDuplication>,
    info: DXGI_OUTDUPL_FRAME_INFO,
}
impl Drop for Acquired {
    fn drop(&mut self) {
        if let Some(duplication) = self.duplication.take() {
            unsafe {
                let _ = duplication.ReleaseFrame();
            }
        }
    }
}
impl Acquired {
    fn finish(mut self) -> Result<(), HostError> {
        if let Some(duplication) = self.duplication.take() {
            unsafe {
                duplication.ReleaseFrame()?;
            }
        }
        Ok(())
    }
}
struct Mapped<'a> {
    context: &'a ID3D11DeviceContext,
    texture: &'a ID3D11Texture2D,
}
impl Drop for Mapped<'_> {
    fn drop(&mut self) {
        unsafe {
            self.context.Unmap(self.texture, 0);
        }
    }
}
struct Device {
    device: ID3D11Device,
    context: ID3D11DeviceContext,
    output: IDXGIOutput,
    duplication: IDXGIOutputDuplication,
    desc: DXGI_OUTPUT_DESC,
    rotation: Rotation,
    raw_width: u32,
    raw_height: u32,
    cursor: Cursor,
    staging: Option<ID3D11Texture2D>,
    pending: Option<Acquired>,
}

/// A frame remains memory-only and must be discarded if the surrounding scope
/// is revoked before encoding/sending. Separate DXGI pointers are already
/// composited into the image; a viewer must not draw that pointer a second time.
pub struct SignInFrame {
    pub image: Snapshot,
    pub cursor_visible: bool,
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub protected_content_masked: bool,
}
impl Drop for SignInFrame {
    fn drop(&mut self) {
        self.image.bgra.zeroize();
    }
}
pub struct SignInCapture {
    scope: Arc<SignInScope>,
    inner: Option<Device>,
}
impl SignInCapture {
    pub fn start(scope: Arc<SignInScope>) -> Result<Self, HostError> {
        let result = Self::start_inner(scope.clone());
        if result.is_err() {
            scope.stop();
        }
        result
    }
    fn start_inner(scope: Arc<SignInScope>) -> Result<Self, HostError> {
        // Reject before any graphics enumeration/device/capture is attempted.
        scope.authorize()?;
        let Primary {
            adapter,
            output,
            desc,
            rotation,
            ..
        } = primary()?;
        scope.authorize()?;
        let mut device = None;
        let mut context = None;
        unsafe {
            D3D11CreateDevice(
                &adapter,
                D3D_DRIVER_TYPE_UNKNOWN,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                Some(&[D3D_FEATURE_LEVEL_11_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut context),
            )?;
        }
        let device = device.ok_or("Missing sign-in graphics device")?;
        let context = context.ok_or("Missing sign-in graphics context")?;
        scope.authorize()?;
        let duplication = unsafe { output.cast::<IDXGIOutput1>()?.DuplicateOutput(&device)? };
        scope.authorize()?;
        // The real surface size comes from the duplication itself. The output's desktop coordinates are scaled
        // down for a process that is not DPI-aware (this worker is not), so they do not match the frames.
        let mode = unsafe { duplication.GetDesc() };
        let (raw_width, raw_height) = (mode.ModeDesc.Width, mode.ModeDesc.Height);
        signin_pixels::dimensions(
            raw_width,
            raw_height,
            raw_width.checked_mul(4).ok_or("Invalid sign-in width")?,
        )?;
        Ok(Self {
            scope,
            inner: Some(Device {
                device,
                context,
                output,
                duplication,
                desc,
                rotation,
                raw_width,
                raw_height,
                cursor: Cursor::default(),
                staging: None,
                pending: None,
            }),
        })
    }
    pub fn display(&self) -> Result<Display, HostError> {
        self.scope.authorize()?;
        let rect = self
            .inner
            .as_ref()
            .ok_or("Sign-in capture ended")?
            .desc
            .DesktopCoordinates;
        Ok(Display {
            id: DISPLAY.into(),
            width: rect.right.abs_diff(rect.left),
            height: rect.bottom.abs_diff(rect.top),
            origin_x: rect.left,
            origin_y: rect.top,
            scale: 1.0,
        })
    }
    /// Nonblocking acquire/map. GPU work in flight returns None, never an old
    /// CPU frame. Access loss/layout changes end the scope; fresh authorization
    /// is required rather than switching desktops or automatically recovering.
    pub fn next_frame(&mut self) -> Result<Option<SignInFrame>, HostError> {
        let result = (|| {
            self.scope.authorize()?;
            let inner = self.inner.as_mut().ok_or("Sign-in capture ended")?;
            let current = unsafe { inner.output.GetDesc()? };
            if !same_output(&inner.desc, &current) {
                return Err("Sign-in display changed".into());
            }
            if inner.pending.is_none() {
                let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
                let mut resource = None;
                match unsafe {
                    inner
                        .duplication
                        .AcquireNextFrame(0, &mut info, &mut resource)
                } {
                    Ok(()) => (),
                    Err(error) if error.code() == DXGI_ERROR_WAIT_TIMEOUT => return Ok(None),
                    Err(error) => return Err(error.into()),
                }
                // Own frame cleanup immediately, including every later error.
                let acquired = Acquired {
                    duplication: Some(inner.duplication.clone()),
                    info,
                };
                let texture: ID3D11Texture2D =
                    resource.ok_or("Missing sign-in frame resource")?.cast()?;
                let mut desc = D3D11_TEXTURE2D_DESC::default();
                unsafe {
                    texture.GetDesc(&mut desc);
                }
                if desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM
                    || desc.Width != inner.raw_width
                    || desc.Height != inner.raw_height
                    || desc.MipLevels != 1
                    || desc.ArraySize != 1
                    || desc.SampleDesc.Count != 1
                {
                    return Err("Sign-in frame geometry changed".into());
                }
                signin_pixels::dimensions(
                    desc.Width,
                    desc.Height,
                    desc.Width.checked_mul(4).ok_or("Invalid sign-in width")?,
                )?;
                if inner.staging.is_none() {
                    desc.Usage = D3D11_USAGE_STAGING;
                    desc.BindFlags = 0;
                    desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
                    desc.MiscFlags = 0;
                    unsafe {
                        inner
                            .device
                            .CreateTexture2D(&desc, None, Some(&mut inner.staging))?;
                    }
                }
                let staging = inner
                    .staging
                    .as_ref()
                    .ok_or("Missing sign-in staging resource")?;
                self.scope.authorize()?;
                unsafe {
                    inner.context.CopyResource(staging, &texture);
                    inner.context.Flush();
                }
                inner.pending = Some(acquired);
            }
            self.scope.authorize()?;
            let staging = inner
                .staging
                .as_ref()
                .ok_or("Missing sign-in staging resource")?;
            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            match unsafe {
                inner.context.Map(
                    staging,
                    0,
                    D3D11_MAP_READ,
                    D3D11_MAP_FLAG_DO_NOT_WAIT.0 as u32,
                    Some(&mut mapped),
                )
            } {
                Ok(()) => (),
                Err(error) if error.code() == DXGI_ERROR_WAS_STILL_DRAWING => return Ok(None),
                Err(error) => return Err(error.into()),
            }
            let unmap = Mapped {
                context: &inner.context,
                texture: staging,
            };
            // The upright frame size, from the real surface (not the DPI-scaled desktop rectangle).
            let (width, height) = inner.rotation.size(inner.raw_width, inner.raw_height);
            let (_, length) =
                signin_pixels::dimensions(inner.raw_width, inner.raw_height, mapped.RowPitch)?;
            if mapped.pData.is_null() {
                return Err("Missing mapped sign-in frame".into());
            }
            let source = unsafe { std::slice::from_raw_parts(mapped.pData.cast::<u8>(), length) };
            let mut pixels = signin_pixels::normalize(
                source,
                inner.raw_width,
                inner.raw_height,
                mapped.RowPitch,
                inner.rotation,
            )?;
            drop(unmap);
            let acquired = inner
                .pending
                .take()
                .ok_or("Missing acquired sign-in frame")?;
            update_cursor(&inner.duplication, &acquired.info, &mut inner.cursor)?;
            inner.cursor.compose(&mut pixels, width, height)?;
            let (cursor_visible, cursor_x, cursor_y) = inner.cursor.state();
            let masked = acquired.info.ProtectedContentMaskedOut.as_bool();
            acquired.finish()?;
            self.scope.authorize()?;
            Ok(Some(SignInFrame {
                image: Snapshot {
                    display_id: DISPLAY.into(),
                    width,
                    height,
                    bgra: std::mem::take(&mut *pixels),
                },
                cursor_visible,
                cursor_x,
                cursor_y,
                protected_content_masked: masked,
            }))
        })();
        if result.is_err() {
            self.scope.stop();
            self.inner.take();
        }
        result
    }
}
impl Drop for SignInCapture {
    fn drop(&mut self) {
        self.scope.stop();
        self.inner.take();
    }
}
fn same_output(a: &DXGI_OUTPUT_DESC, b: &DXGI_OUTPUT_DESC) -> bool {
    a.Monitor == b.Monitor
        && a.AttachedToDesktop == b.AttachedToDesktop
        && a.Rotation == b.Rotation
        && a.DesktopCoordinates == b.DesktopCoordinates
        && a.DeviceName == b.DeviceName
}
fn update_cursor(
    duplication: &IDXGIOutputDuplication,
    frame: &DXGI_OUTDUPL_FRAME_INFO,
    cursor: &mut Cursor,
) -> Result<(), HostError> {
    let position = frame.PointerPosition;
    cursor.position(
        frame.LastMouseUpdateTime,
        position.Position.x,
        position.Position.y,
        position.Visible.as_bool(),
    );
    let mut size = frame.PointerShapeBufferSize;
    if size == 0 && !cursor.needs_shape() {
        return Ok(());
    }
    let mut info = DXGI_OUTDUPL_POINTER_SHAPE_INFO::default();
    if size == 0 {
        let query = unsafe {
            duplication.GetFramePointerShape(0, std::ptr::null_mut(), &mut size, &mut info)
        };
        if let Err(error) = query {
            if error.code() != DXGI_ERROR_MORE_DATA {
                return Err(error.into());
            }
        }
    }
    if size == 0 || size as usize > signin_pixels::MAX_CURSOR {
        return Err("Invalid sign-in pointer buffer size".into());
    }
    let mut bytes = Zeroizing::new(vec![0u8; size as usize]);
    let mut required = 0;
    unsafe {
        duplication.GetFramePointerShape(
            size,
            bytes.as_mut_ptr().cast(),
            &mut required,
            &mut info,
        )?;
    }
    if required == 0 || required > size {
        return Err("Invalid sign-in pointer buffer result".into());
    }
    bytes.truncate(required as usize);
    cursor.shape(info.Type, info.Width, info.Height, info.Pitch, bytes)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preflight_rejects_noninteractive_console_ids_before_graphics_enumeration() {
        assert!(preflight(0).is_err());
        assert!(preflight(u32::MAX).is_err());
    }
    #[test]
    fn authorized_lease_without_a_peer_cannot_initialize_capture() {
        use std::sync::atomic::AtomicBool;
        let scope = SignInScope::new(
            uuid::Uuid::new_v4().to_string(),
            uuid::Uuid::new_v4().to_string(),
            2,
            crate::signin_scope::tick() + 10_000 * crate::signin_scope::TICKS_PER_MILLISECOND,
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        assert!(SignInCapture::start(scope.clone()).is_err());
        assert!(scope.expired());
    }
}
