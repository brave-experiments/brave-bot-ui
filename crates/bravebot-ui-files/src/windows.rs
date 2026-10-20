//! The Windows operations. Each open uses `NtCreateFile` from a directory handle that is
//! already open, as `openat` does on Unix. The usual Win32 calls look up a whole path again each
//! time, so a folder in it could be swapped between two calls.
//!
//! Windows marks links, and some other special files, as reparse points. Each is opened without
//! being followed. One that points somewhere else (a symlink, junction or mount point) is
//! refused. Others, such as a cloud placeholder or a deduplicated file, belong to a file system
//! filter that has to handle the open. Those are opened again through the filter, and kept only
//! if both opens reach the same file.
//!
//! On Unix, a file's mode can keep other accounts out. Here a new file gets an access list that
//! names only the current account instead. The list is set as the file is created and marked
//! protected, so the folder's permissions never pass down to it. On a network share the server
//! may not know this account, so there a new file gets the share's usual permissions.
#![allow(unsafe_code)]

use std::ffi::{OsStr, c_void};
use std::fs::File;
use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Component, Path, Prefix};
use std::ptr::{null, null_mut};
use windows_sys::Wdk::Foundation::OBJECT_ATTRIBUTES;
use windows_sys::Wdk::Storage::FileSystem::{
    FILE_CREATE, FILE_DIRECTORY_FILE, FILE_NON_DIRECTORY_FILE, FILE_OPEN, FILE_OPEN_IF,
    FILE_OPEN_REPARSE_POINT, FILE_RENAME_INFORMATION, FILE_SYNCHRONOUS_IO_NONALERT,
    FileFsDeviceInformation, FileRenameInformation, NtCreateFile, NtQueryVolumeInformationFile,
    NtSetInformationFile,
};
use windows_sys::Wdk::System::SystemServices::{FILE_FS_DEVICE_INFORMATION, FILE_REMOTE_DEVICE};
use windows_sys::Win32::Foundation::{
    LocalFree, OBJ_CASE_INSENSITIVE, RtlNtStatusToDosError, UNICODE_STRING,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{GetTokenInformation, TOKEN_QUERY, TOKEN_USER, TokenUser};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT, FILE_ATTRIBUTE_TAG_INFO,
    FILE_DISPOSITION_INFO, FILE_GENERIC_READ, FILE_GENERIC_WRITE, FILE_ID_INFO,
    FILE_LIST_DIRECTORY, FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ,
    FILE_SHARE_WRITE, FILE_TRAVERSE, FileAttributeTagInfo, FileDispositionInfo, FileIdInfo,
    GetFileInformationByHandleEx, SYNCHRONIZE, SetFileInformationByHandle,
};
use windows_sys::Win32::System::IO::IO_STATUS_BLOCK;
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

/// The reparse tag bit that `IsReparseTagNameSurrogate` checks. It is set when the entry points
/// somewhere else.
const NAME_SURROGATE: u32 = 0x2000_0000;
const DIRECTORY_ACCESS: u32 = FILE_LIST_DIRECTORY | FILE_TRAVERSE | FILE_READ_ATTRIBUTES;

/// The access list for a file that only this account can use. `P` stops the folder's
/// permissions from passing down, and an account not on the list gets no access.
fn private_file(account: &str) -> String {
    format!("D:P(A;;FA;;;{account})")
}
/// The same for a directory. `OICI` passes the list down to files and folders made inside it.
fn private_directory(account: &str) -> String {
    format!("D:P(A;OICI;FA;;;{account})")
}

/// Checks a single name inside a directory, and returns it as UTF-16. A `:` is refused, since
/// `file:name` would open a separate stream of data stored in `file`.
fn name(part: &str) -> io::Result<Vec<u16>> {
    if part.is_empty() || part == "." || part == ".." || part.contains(['/', '\\', ':', '\0']) {
        return Err(io::Error::other("Invalid file name"));
    }
    Ok(part.encode_utf16().collect())
}

fn nt_error(status: i32) -> io::Error {
    io::Error::from_raw_os_error(unsafe { RtlNtStatusToDosError(status) } as i32)
}

fn link_refused() -> io::Error {
    io::Error::other("Links are not followed")
}

/// Memory that a Windows security function allocated. Dropping it frees it with `LocalFree`.
struct Local(*mut c_void);
impl Drop for Local {
    fn drop(&mut self) {
        unsafe { LocalFree(self.0) };
    }
}

fn wide_string(pointer: *const u16) -> String {
    let length = (0..)
        .take_while(|&i| unsafe { *pointer.add(i) } != 0)
        .count();
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(pointer, length) })
}

/// The current account's security ID (SID), in the text form that SDDL uses.
fn account() -> io::Result<String> {
    let mut token = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let token = unsafe { OwnedHandle::from_raw_handle(token) };
    let mut size = 0;
    unsafe { GetTokenInformation(token.as_raw_handle(), TokenUser, null_mut(), 0, &mut size) };
    let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
    let ok = unsafe {
        GetTokenInformation(
            token.as_raw_handle(),
            TokenUser,
            buffer.as_mut_ptr().cast(),
            size,
            &mut size,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
    let mut text = null_mut();
    if unsafe { ConvertSidToStringSidW(user.User.Sid, &mut text) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let text = Local(text.cast());
    Ok(wide_string(text.0.cast()))
}

fn descriptor(sddl: &str) -> io::Result<Local> {
    let sddl: Vec<u16> = sddl.encode_utf16().chain([0]).collect();
    let mut descriptor = null_mut();
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            null_mut(),
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(Local(descriptor))
}

/// Calls `NtCreateFile` once. It opens `name` inside `parent`, or, when there is no parent,
/// the full NT path `name`.
fn nt_open(
    parent: Option<&File>,
    name: &[u16],
    access: u32,
    disposition: u32,
    options: u32,
    security: Option<&Local>,
) -> io::Result<File> {
    let bytes = u16::try_from(name.len() * 2).map_err(|_| io::Error::other("Name too long"))?;
    let object_name = UNICODE_STRING {
        Length: bytes,
        MaximumLength: bytes,
        Buffer: name.as_ptr().cast_mut(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: size_of::<OBJECT_ATTRIBUTES>() as u32,
        RootDirectory: parent.map_or(null_mut(), |parent| parent.as_raw_handle()),
        ObjectName: &object_name,
        Attributes: OBJ_CASE_INSENSITIVE,
        SecurityDescriptor: security.map_or(null(), |security| security.0.cast()),
        SecurityQualityOfService: null(),
    };
    let mut handle = null_mut();
    let mut status_block = IO_STATUS_BLOCK::default();
    let status = unsafe {
        NtCreateFile(
            &mut handle,
            access | SYNCHRONIZE,
            &attributes,
            &mut status_block,
            null(),
            FILE_ATTRIBUTE_NORMAL,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            disposition,
            options | FILE_SYNCHRONOUS_IO_NONALERT,
            null(),
            0,
        )
    };
    if status < 0 {
        return Err(nt_error(status));
    }
    Ok(File::from(unsafe { OwnedHandle::from_raw_handle(handle) }))
}

fn information<T: Default>(file: &File, class: i32) -> io::Result<T> {
    let mut value = T::default();
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            class,
            (&raw mut value).cast(),
            size_of::<T>() as u32,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(value)
}

fn same_file(a: &File, b: &File) -> io::Result<bool> {
    let a: FILE_ID_INFO = information(a, FileIdInfo)?;
    let b: FILE_ID_INFO = information(b, FileIdInfo)?;
    Ok(a.VolumeSerialNumber == b.VolumeSerialNumber && a.FileId.Identifier == b.FileId.Identifier)
}

/// Opens `name` in `parent` without following any link, then applies the reparse point rules
/// in the module comment.
fn open_no_follow(
    parent: &File,
    name: &str,
    access: u32,
    disposition: u32,
    options: u32,
    security: Option<&Local>,
) -> io::Result<File> {
    let name = self::name(name)?;
    let access = access | FILE_READ_ATTRIBUTES;
    let open = |extra| {
        nt_open(
            Some(parent),
            &name,
            access,
            disposition,
            options | extra,
            security,
        )
    };
    let file = open(FILE_OPEN_REPARSE_POINT)?;
    let tag: FILE_ATTRIBUTE_TAG_INFO = information(&file, FileAttributeTagInfo)?;
    if tag.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
        return Ok(file);
    }
    if tag.ReparseTag & NAME_SURROGATE != 0 {
        return Err(link_refused());
    }
    let filtered = open(0)?;
    if !same_file(&file, &filtered)? {
        return Err(link_refused());
    }
    Ok(filtered)
}

/// Whether `file` is on a network drive or share. `GetDriveType` makes the same check.
fn remote(file: &File) -> io::Result<bool> {
    let mut device = FILE_FS_DEVICE_INFORMATION::default();
    let mut status_block = IO_STATUS_BLOCK::default();
    let status = unsafe {
        NtQueryVolumeInformationFile(
            file.as_raw_handle(),
            &mut status_block,
            (&raw mut device).cast(),
            size_of::<FILE_FS_DEVICE_INFORMATION>() as u32,
            FileFsDeviceInformation,
        )
    };
    if status < 0 {
        return Err(nt_error(status));
    }
    Ok(device.Characteristics & FILE_REMOTE_DEVICE != 0)
}

/// The access list for a new file or folder in `parent`. On a network share there is none,
/// for the reason in the module comment.
fn private_security(parent: &File, list: fn(&str) -> String) -> io::Result<Option<Local>> {
    if remote(parent)? {
        return Ok(None);
    }
    descriptor(&list(&account()?)).map(Some)
}

/// The server or share name from `\\server\share`, checked like a single file name.
fn share_part(part: &OsStr) -> io::Result<&str> {
    part.to_str()
        .filter(|part| name(part).is_ok())
        .ok_or_else(|| io::Error::other("Invalid network share"))
}

/// Opens the root of a drive or network share. Returns it with the rest of `root`, the part
/// left to walk. Device paths are refused, because their root is not a directory.
pub fn volume_root(root: &Path) -> io::Result<(File, &Path)> {
    let mut components = root.components();
    let volume = match components.next() {
        Some(Component::Prefix(prefix)) => match prefix.kind() {
            Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) => {
                format!(r"\??\{}:\", char::from(drive))
            }
            Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => {
                format!(r"\??\UNC\{}\{}\", share_part(server)?, share_part(share)?)
            }
            _ => {
                return Err(io::Error::other(
                    "Project root must be on a drive or a network share",
                ));
            }
        },
        _ => return Err(io::Error::other("Project root must be absolute")),
    };
    if components.next() != Some(Component::RootDir) {
        return Err(io::Error::other("Project root must be absolute"));
    }
    let volume: Vec<u16> = volume.encode_utf16().collect();
    let directory = nt_open(
        None,
        &volume,
        DIRECTORY_ACCESS,
        FILE_OPEN,
        FILE_DIRECTORY_FILE,
        None,
    )?;
    Ok((directory, components.as_path()))
}

pub fn open_directory(parent: &File, name: &str, create: bool) -> io::Result<File> {
    let (disposition, security) = if create {
        (FILE_OPEN_IF, private_security(parent, private_directory)?)
    } else {
        (FILE_OPEN, None)
    };
    open_no_follow(
        parent,
        name,
        DIRECTORY_ACCESS,
        disposition,
        FILE_DIRECTORY_FILE,
        security.as_ref(),
    )
}

pub fn open_file(parent: &File, name: &str) -> io::Result<File> {
    open_no_follow(
        parent,
        name,
        FILE_GENERIC_READ,
        FILE_OPEN,
        FILE_NON_DIRECTORY_FILE,
        None,
    )
}

/// Fails if anything, even a link, already has the name. `FILE_CREATE` never opens what is there.
pub fn create_private(parent: &File, name: &str) -> io::Result<File> {
    let security = private_security(parent, private_file)?;
    open_no_follow(
        parent,
        name,
        FILE_GENERIC_WRITE,
        FILE_CREATE,
        FILE_NON_DIRECTORY_FILE,
        security.as_ref(),
    )
}

/// Opens `name` so it can be renamed or deleted. If it is a link, the link itself is opened,
/// not what it points to, as with `renameat` and `unlinkat` on Unix.
fn open_for_delete(parent: &File, name: &str, options: u32) -> io::Result<File> {
    let name = self::name(name)?;
    let access = DELETE | FILE_READ_ATTRIBUTES;
    nt_open(
        Some(parent),
        &name,
        access,
        FILE_OPEN,
        options | FILE_OPEN_REPARSE_POINT,
        None,
    )
}

/// Renames a file inside `parent`. The new name is looked up in the open `parent`, not by path.
pub fn rename(parent: &File, from: &str, to: &str) -> io::Result<()> {
    let file = open_for_delete(parent, from, 0)?;
    let to = self::name(to)?;
    // The structure ends in a name array of length one, so its size can be more than the
    // header plus a short name. The buffer takes whichever is larger.
    let header = std::mem::offset_of!(FILE_RENAME_INFORMATION, FileName);
    let size = (header + to.len() * 2).max(size_of::<FILE_RENAME_INFORMATION>());
    let mut buffer = vec![0u64; size.div_ceil(8)];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFORMATION>();
    let mut status_block = IO_STATUS_BLOCK::default();
    let status = unsafe {
        (*info).Anonymous.ReplaceIfExists = true;
        (*info).RootDirectory = parent.as_raw_handle();
        (*info).FileNameLength = (to.len() * 2) as u32;
        std::ptr::copy_nonoverlapping(
            to.as_ptr(),
            (&raw mut (*info).FileName).cast::<u16>(),
            to.len(),
        );
        NtSetInformationFile(
            file.as_raw_handle(),
            &mut status_block,
            info.cast(),
            size as u32,
            FileRenameInformation,
        )
    };
    if status < 0 {
        return Err(nt_error(status));
    }
    Ok(())
}

pub fn remove(parent: &File, name: &str) -> io::Result<()> {
    let file = open_for_delete(parent, name, FILE_NON_DIRECTORY_FILE)?;
    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    let ok = unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileDispositionInfo,
            (&raw const disposition).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
pub mod testing {
    use super::*;
    use std::os::windows::fs::{OpenOptionsExt, symlink_dir, symlink_file};
    use std::process::Command;
    use windows_sys::Win32::Security::Authorization::{
        ConvertSecurityDescriptorToStringSecurityDescriptorW, GetSecurityInfo, SE_FILE_OBJECT,
    };
    use windows_sys::Win32::Security::DACL_SECURITY_INFORMATION;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, READ_CONTROL,
    };

    /// A Windows symlink needs Developer Mode or administrator rights. Without either, this fails.
    pub fn link_directory(target: &Path, link: &Path) {
        symlink_dir(target, link).expect("creating a symlink needs Developer Mode or elevation");
    }
    pub fn link_file(target: &Path, link: &Path) {
        symlink_file(target, link).expect("creating a symlink needs Developer Mode or elevation");
    }
    /// A junction is a link that `is_symlink` does not report. Making one needs no special rights.
    pub fn junction(target: &Path, link: &Path) {
        let status = Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(link)
            .arg(target)
            .output()
            .unwrap()
            .status;
        assert!(status.success(), "mklink /J failed");
    }

    /// Turns `C:\…` into `\\localhost\C$\…`, the same path reached through this computer's own
    /// administrative share.
    pub fn loopback_share(path: &str) -> String {
        let (drive, rest) = path.split_once(r":\").expect("a drive path");
        format!(r"\\localhost\{drive}$\{rest}")
    }

    /// Compares rendered SDDL on both sides, because Windows renders some SIDs as aliases: the
    /// built-in Administrator (RID 500, which CI runs as) comes back as `LA`, not its SID.
    pub fn assert_private(path: &Path) {
        let expected = descriptor(&private_file(&account().unwrap())).unwrap();
        assert_eq!(access_list(path), sddl(&expected), "{}", path.display());
    }

    /// The access list of `path`, as SDDL.
    pub fn access_list(path: &Path) -> String {
        let file = std::fs::OpenOptions::new()
            .access_mode(READ_CONTROL)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(path)
            .unwrap();
        let mut security = null_mut();
        let status = unsafe {
            GetSecurityInfo(
                file.as_raw_handle(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                &mut security,
            )
        };
        assert_eq!(status, 0, "{}", path.display());
        sddl(&Local(security))
    }

    fn sddl(security: &Local) -> String {
        let mut text = null_mut();
        let ok = unsafe {
            ConvertSecurityDescriptorToStringSecurityDescriptorW(
                security.0,
                SDDL_REVISION_1,
                DACL_SECURITY_INFORMATION,
                &mut text,
                null_mut(),
            )
        };
        assert_ne!(ok, 0);
        let text = Local(text.cast());
        wide_string(text.0.cast())
    }
}
