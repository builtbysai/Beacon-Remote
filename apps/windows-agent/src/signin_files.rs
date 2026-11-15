//! Administrator-controlled sign-in installation files. Never overwrites an
//! identity or follows a reparse point. Binary versions are immutable.
use crate::{
    availability::{descriptor_string, reject_reparse},
    HostError,
};
use std::{
    fs,
    io::{Read, Write},
    os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    path::Path,
    ptr::{null, null_mut},
};
use windows_service::service::Service;
use windows_sys::Win32::{
    Foundation::{
        GetLastError, LocalFree, ERROR_ALREADY_EXISTS, ERROR_FILE_EXISTS, HANDLE,
        INVALID_HANDLE_VALUE,
    },
    Security::{
        Authorization::{
            ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo, SetSecurityInfo,
            SE_SERVICE,
        },
        CreateWellKnownSid, GetFileSecurityW, GetSecurityDescriptorDacl,
        GetSecurityDescriptorGroup, GetSecurityDescriptorOwner, GetTokenInformation,
        SetTokenInformation, TokenOwner, WinBuiltinAdministratorsSid, SECURITY_ATTRIBUTES,
        TOKEN_ADJUST_DEFAULT, TOKEN_OWNER, TOKEN_QUERY,
    },
    Storage::FileSystem::{
        CreateFileW, LockFileEx, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, FILE_FLAG_OPEN_REPARSE_POINT,
        FILE_FLAG_WRITE_THROUGH, FILE_SHARE_READ, FILE_SHARE_WRITE, LOCKFILE_EXCLUSIVE_LOCK,
        LOCKFILE_FAIL_IMMEDIATELY, OPEN_EXISTING,
    },
    System::{
        Threading::{GetCurrentProcess, OpenProcessToken},
        IO::OVERLAPPED,
    },
};

pub(crate) const PRIVATE_FILE: &str = "O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)";
pub(crate) const PUBLIC_FILE: &str = "O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;BU)";
// The only user mutation is deleting this non-secret enable marker. Its parent
// directory grants no file creation, so a user cannot restore it or enable access.
pub(crate) const ENABLE_FILE: &str =
    "O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;BU)(A;;0x10000;;;IU)";
const SECURITY: u32 = 1 | 2 | 4;
// Interactive users may send only fixed one-way revoke/query controls. They
// cannot start/stop/reconfigure the service or change its protected descriptor.
const SERVICE_ACL: &str =
    "O:BAG:BAD:P(A;;0xf01ff;;;SY)(A;;0xf01ff;;;BA)(A;;0x20085;;;BU)(A;;0x100;;;IU)";
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
struct Descriptor(*mut std::ffi::c_void);
impl Descriptor {
    fn new(acl: &str) -> Result<Self, HostError> {
        let mut descriptor = null_mut();
        let acl = wide(acl);
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                acl.as_ptr(),
                1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(Self(descriptor))
    }
}
impl Drop for Descriptor {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.0);
        }
    }
}
fn owned(handle: HANDLE) -> Result<OwnedHandle, HostError> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

pub(crate) fn verify_service(service: &Service) -> Result<(), HostError> {
    let expected = Descriptor::new(SERVICE_ACL)?;
    let mut raw = null_mut();
    let code = unsafe {
        GetSecurityInfo(
            service.raw_handle(),
            SE_SERVICE,
            SECURITY,
            null_mut(),
            null_mut(),
            null_mut(),
            null_mut(),
            &mut raw,
        )
    };
    if code != 0 {
        return Err(std::io::Error::from_raw_os_error(code as i32).into());
    }
    let descriptor = Descriptor(raw);
    if unsafe { descriptor_string(descriptor.0)? }.replace("D:PAI", "D:P")
        != unsafe { descriptor_string(expected.0)? }.replace("D:PAI", "D:P")
    {
        return Err("Sign-in service owner or permissions changed; refusing to modify it".into());
    }
    Ok(())
}
pub(crate) fn protect_new_service(service: &Service) -> Result<(), HostError> {
    let descriptor = Descriptor::new(SERVICE_ACL)?;
    let mut owner = null_mut();
    let mut group = null_mut();
    let mut dacl = null_mut();
    let mut present = 0;
    let mut defaulted = 0;
    if unsafe { GetSecurityDescriptorOwner(descriptor.0, &mut owner, &mut defaulted) } == 0
        || unsafe { GetSecurityDescriptorGroup(descriptor.0, &mut group, &mut defaulted) } == 0
        || unsafe {
            GetSecurityDescriptorDacl(descriptor.0, &mut present, &mut dacl, &mut defaulted)
        } == 0
        || present == 0
        || dacl.is_null()
    {
        return Err("Invalid protected service descriptor".into());
    }
    let code = unsafe {
        SetSecurityInfo(
            service.raw_handle(),
            SE_SERVICE,
            SECURITY | 0x80000000,
            owner,
            group,
            dacl,
            null_mut(),
        )
    };
    if code != 0 {
        return Err(std::io::Error::from_raw_os_error(code as i32).into());
    }
    verify_service(service)
}

struct OwnerRestore {
    token: OwnedHandle,
    previous: Vec<usize>,
    restored: bool,
}
impl OwnerRestore {
    fn restore(&mut self) -> Result<(), HostError> {
        if !self.restored {
            if unsafe {
                SetTokenInformation(
                    self.token.as_raw_handle(),
                    TokenOwner,
                    self.previous.as_ptr().cast(),
                    std::mem::size_of::<TOKEN_OWNER>() as u32,
                )
            } == 0
            {
                return Err(std::io::Error::last_os_error().into());
            }
            self.restored = true;
        }
        Ok(())
    }
}
impl Drop for OwnerRestore {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}
/// CreateService has no security-descriptor argument. Give this elevated
/// installer's own token an Administrators default owner for the narrow create
/// operation, then restore it. No other process token is opened or borrowed.
/// This avoids a creator-user WRITE_DAC window before explicit service hardening.
pub(crate) fn with_administrator_owner<T>(
    action: impl FnOnce() -> Result<T, HostError>,
) -> Result<T, HostError> {
    let mut token = null_mut();
    if unsafe {
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_QUERY | TOKEN_ADJUST_DEFAULT,
            &mut token,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let token = owned(token)?;
    let mut needed = 0;
    unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenOwner,
            null_mut(),
            0,
            &mut needed,
        );
    }
    if needed == 0 || needed > 65536 {
        return Err("Invalid installer token owner".into());
    }
    let mut previous = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
    if unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenOwner,
            previous.as_mut_ptr().cast(),
            needed,
            &mut needed,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let mut admin = [0usize; 16];
    let mut length = std::mem::size_of_val(&admin) as u32;
    if unsafe {
        CreateWellKnownSid(
            WinBuiltinAdministratorsSid,
            null_mut(),
            admin.as_mut_ptr().cast(),
            &mut length,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    let owner = TOKEN_OWNER {
        Owner: admin.as_mut_ptr().cast(),
    };
    if unsafe {
        SetTokenInformation(
            token.as_raw_handle(),
            TokenOwner,
            std::ptr::from_ref(&owner).cast(),
            std::mem::size_of_val(&owner) as u32,
        )
    } == 0
    {
        return Err("The elevated installer cannot create an administrator-owned service; no service was created".into());
    }
    let mut restore = OwnerRestore {
        token,
        previous,
        restored: false,
    };
    let result = action();
    restore.restore()?;
    result
}

pub(crate) fn verify(path: &Path, acl: &str) -> Result<(), HostError> {
    verify_kind(path, acl, false)
}
pub(crate) fn verify_directory(path: &Path, acl: &str) -> Result<(), HostError> {
    verify_kind(path, acl, true)
}
fn verify_kind(path: &Path, acl: &str, directory: bool) -> Result<(), HostError> {
    reject_reparse(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if (directory && !metadata.is_dir()) || (!directory && !metadata.is_file()) {
        return Err("Unexpected sign-in installation file/directory type".into());
    }
    let expected = Descriptor::new(acl)?;
    let path = wide(&path.to_string_lossy());
    let mut needed = 0;
    unsafe {
        GetFileSecurityW(path.as_ptr(), SECURITY, null_mut(), 0, &mut needed);
    }
    if needed == 0 || needed > 65536 {
        return Err("Invalid sign-in file descriptor".into());
    }
    let mut descriptor = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
    if unsafe {
        GetFileSecurityW(
            path.as_ptr(),
            SECURITY,
            descriptor.as_mut_ptr().cast(),
            needed,
            &mut needed,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    if unsafe { descriptor_string(descriptor.as_mut_ptr().cast())? }.replace("D:PAI", "D:P")
        != unsafe { descriptor_string(expected.0)? }.replace("D:PAI", "D:P")
    {
        return Err("Sign-in file owner or permissions changed; refusing to use it".into());
    }
    Ok(())
}

pub(crate) fn read(path: &Path, acl: &str, limit: usize) -> Result<Vec<u8>, HostError> {
    verify(path, acl)?;
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err("Sign-in installation file is too large".into());
    }
    Ok(bytes)
}

/// Create with its final owner/DACL atomically. An existing file is accepted
/// only when both its descriptor and bytes match; no replacement/truncation.
pub(crate) fn create(path: &Path, bytes: &[u8], acl: &str) -> Result<(), HostError> {
    reject_reparse(path)?;
    let descriptor = Descriptor::new(acl)?;
    let attributes = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: descriptor.0,
        bInheritHandle: 0,
    };
    let path_wide = wide(&path.to_string_lossy());
    let handle = unsafe {
        CreateFileW(
            path_wide.as_ptr(),
            0x40000000,
            FILE_SHARE_READ,
            &attributes,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH | FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        let error = unsafe { GetLastError() };
        if error == ERROR_FILE_EXISTS || error == ERROR_ALREADY_EXISTS {
            if read(path, acl, bytes.len())? == bytes {
                return Ok(());
            }
            return Err("Existing sign-in file does not match; it was not replaced".into());
        }
        return Err(std::io::Error::from_raw_os_error(error as i32).into());
    }
    let mut file = fs::File::from(owned(handle)?);
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    verify(path, acl)
}

/// Cross-process maintenance lock. Closing the handle releases it, including
/// on process crash; there are no stale PIDs or commands to recover/execute.
pub(crate) fn maintenance_lock(path: &Path) -> Result<OwnedHandle, HostError> {
    maintenance_with_acl(path, PRIVATE_FILE)
}
fn maintenance_with_acl(path: &Path, acl: &str) -> Result<OwnedHandle, HostError> {
    create(path, &[], acl)?;
    let path_wide = wide(&path.to_string_lossy());
    let handle = owned(unsafe {
        CreateFileW(
            path_wide.as_ptr(),
            0x80000000 | 0x40000000,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            null(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        )
    })?;
    let mut overlap = OVERLAPPED::default();
    if unsafe {
        LockFileEx(
            handle.as_raw_handle(),
            LOCKFILE_EXCLUSIVE_LOCK | LOCKFILE_FAIL_IMMEDIATELY,
            0,
            1,
            0,
            &mut overlap,
        )
    } == 0
    {
        return Err(
            "Another sign-in maintenance operation is active; no installed service was changed"
                .into(),
        );
    }
    Ok(handle)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_revoke_permissions_cannot_restore_enable_marker_or_control_service() {
        use windows_sys::Win32::Security::{
            Authorization::*, WinBuiltinUsersSid, WinInteractiveSid, WinLocalSystemSid,
            WinNetworkSid,
        };
        struct Resource(AUTHZ_RESOURCE_MANAGER_HANDLE);
        impl Drop for Resource {
            fn drop(&mut self) {
                unsafe {
                    AuthzFreeResourceManager(self.0);
                }
            }
        }
        struct Context(AUTHZ_CLIENT_CONTEXT_HANDLE);
        impl Drop for Context {
            fn drop(&mut self) {
                unsafe {
                    AuthzFreeContext(self.0);
                }
            }
        }
        let mut resource = null_mut();
        assert_ne!(
            unsafe {
                AuthzInitializeResourceManager(
                    AUTHZ_RM_FLAG_NO_AUDIT,
                    None,
                    None,
                    None,
                    null(),
                    &mut resource,
                )
            },
            0
        );
        let resource = Resource(resource);
        let allowed = |acl: &str, sid_type, access| {
            let descriptor = Descriptor::new(acl).unwrap();
            let mut sid = [0usize; 16];
            let mut size = std::mem::size_of_val(&sid) as u32;
            assert_ne!(
                unsafe {
                    CreateWellKnownSid(sid_type, null_mut(), sid.as_mut_ptr().cast(), &mut size)
                },
                0
            );
            let mut context = null_mut();
            // Evaluate explicit Windows logon roles without depending on the
            // runner's elevation/logon type, domain queries or an SCM mutation.
            assert_ne!(
                unsafe {
                    AuthzInitializeContextFromSid(
                        AUTHZ_SKIP_TOKEN_GROUPS,
                        sid.as_mut_ptr().cast(),
                        resource.0,
                        null(),
                        Default::default(),
                        null(),
                        &mut context,
                    )
                },
                0
            );
            let context = Context(context);
            let request = AUTHZ_ACCESS_REQUEST {
                DesiredAccess: access,
                ..Default::default()
            };
            let mut granted = 0;
            let mut error = 0;
            let mut reply = AUTHZ_ACCESS_REPLY {
                ResultListLength: 1,
                GrantedAccessMask: &mut granted,
                Error: &mut error,
                ..Default::default()
            };
            assert_ne!(
                unsafe {
                    AuthzAccessCheck(
                        0,
                        context.0,
                        &request,
                        null_mut(),
                        descriptor.0,
                        null(),
                        0,
                        &mut reply,
                        null_mut(),
                    )
                },
                0
            );
            error == 0 && granted & access == access
        };
        assert!(allowed(SERVICE_ACL, WinInteractiveSid, 0x100));
        assert!(!allowed(SERVICE_ACL, WinNetworkSid, 0x100));
        assert!(!allowed(SERVICE_ACL, WinBuiltinUsersSid, 0x100));
        for access in [0x2, 0x10, 0x20, 0x40, 0x10000, 0x40000, 0x80000] {
            assert!(!allowed(SERVICE_ACL, WinInteractiveSid, access));
        }
        assert!(allowed(SERVICE_ACL, WinLocalSystemSid, 0xf01ff));
        assert!(allowed(SERVICE_ACL, WinBuiltinAdministratorsSid, 0xf01ff));
        assert!(allowed(ENABLE_FILE, WinInteractiveSid, 0x10000));
        assert!(!allowed(ENABLE_FILE, WinNetworkSid, 0x10000));
        assert!(!allowed(ENABLE_FILE, WinBuiltinUsersSid, 0x10000));
        for access in [0x2, 0x4, 0x10, 0x100, 0x40000, 0x80000] {
            assert!(!allowed(ENABLE_FILE, WinInteractiveSid, access));
        }
        // Deleting the marker cannot grant its recreation in the protected
        // parent, nor deletion/replacement of sibling manifests or executables.
        for role in [WinInteractiveSid, WinBuiltinUsersSid, WinNetworkSid] {
            for access in [0x2, 0x4, 0x40, 0x10000, 0x40000, 0x80000] {
                assert!(!allowed(crate::availability::PUBLIC_ACL, role, access));
            }
            assert!(!allowed(PUBLIC_FILE, role, 0x10000));
        }
    }
    #[test]
    fn file_owner_acl_and_content_are_checked_without_overwriting_existing_state() {
        let root =
            std::env::temp_dir().join(format!("beacon-signin-files-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let file = root.join("fixture.bin");
        let sid = crate::availability::current_sid().unwrap();
        let acl = format!("O:{sid}G:{sid}D:P(A;;FA;;;{sid})");
        create(&file, b"disposable fixture", &acl).unwrap();
        create(&file, b"disposable fixture", &acl).unwrap();
        assert!(create(&file, b"different", &acl).is_err());
        assert!(read(&file, &acl, 3).is_err());
        assert!(verify(&file, &format!("{acl}(A;;FR;;;BU)")).is_err());
        assert_eq!(read(&file, &acl, 64).unwrap(), b"disposable fixture");
        fs::remove_file(&file).unwrap();
        fs::remove_dir(&root).unwrap();
    }
    #[test]
    fn maintenance_is_exclusive_and_handle_close_recovers_without_stale_owner_state() {
        let root =
            std::env::temp_dir().join(format!("beacon-signin-lock-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let file = root.join("maintenance.lock");
        let sid = crate::availability::current_sid().unwrap();
        let acl = format!("O:{sid}G:{sid}D:P(A;;FA;;;{sid})");
        let first = maintenance_with_acl(&file, &acl).unwrap();
        assert!(maintenance_with_acl(&file, &acl).is_err());
        drop(first);
        let next = maintenance_with_acl(&file, &acl).unwrap();
        drop(next);
        let absent = root.join("not-created");
        assert!(verify_directory(&absent, &acl).is_err());
        assert!(!absent.exists());
        fs::remove_file(&file).unwrap();
        fs::remove_dir(&root).unwrap();
    }
}
