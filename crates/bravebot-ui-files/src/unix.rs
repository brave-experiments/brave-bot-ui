//! The Unix operations. Each open uses `openat` from a directory that is already open, with
//! `O_NOFOLLOW` so that a link is never followed.

use rustix::fs::{self, AtFlags, Mode, OFlags};
use std::fs::File;
use std::io;
use std::path::Path;

fn open_at(parent: &File, name: &str, flags: OFlags) -> io::Result<File> {
    // `File::from` takes ownership of the returned `OwnedFd`, so no raw descriptor is handled here.
    fs::openat(
        parent,
        name,
        flags | OFlags::CLOEXEC | OFlags::NOFOLLOW | OFlags::NONBLOCK,
        Mode::RUSR | Mode::WUSR,
    )
    .map(File::from)
    .map_err(Into::into)
}

/// Opens the filesystem root. Returns it with the rest of `root`, the part left to walk.
pub fn volume_root(root: &Path) -> io::Result<(File, &Path)> {
    let rest = root
        .strip_prefix("/")
        .map_err(|_| io::Error::other("Project root must be absolute"))?;
    Ok((File::open("/")?, rest))
}

pub fn open_directory(parent: &File, name: &str, create: bool) -> io::Result<File> {
    if create {
        match fs::mkdirat(parent, name, Mode::RWXU) {
            Ok(()) | Err(rustix::io::Errno::EXIST) => {}
            Err(error) => return Err(error.into()),
        }
    }
    open_at(parent, name, OFlags::RDONLY | OFlags::DIRECTORY)
}

pub fn open_file(parent: &File, name: &str) -> io::Result<File> {
    open_at(parent, name, OFlags::RDONLY)
}

/// Fails if anything, even a link, already has the name. `O_EXCL` never opens what is there.
pub fn create_private(parent: &File, name: &str) -> io::Result<File> {
    open_at(parent, name, OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL)
}

pub fn rename(parent: &File, from: &str, to: &str) -> io::Result<()> {
    fs::renameat(parent, from, parent, to).map_err(Into::into)
}

pub fn remove(parent: &File, name: &str) -> io::Result<()> {
    fs::unlinkat(parent, name, AtFlags::empty()).map_err(Into::into)
}

#[cfg(test)]
pub mod testing {
    use std::os::unix::fs::{PermissionsExt, symlink};
    use std::path::Path;

    pub fn link_directory(target: &Path, link: &Path) {
        symlink(target, link).unwrap();
    }
    pub fn link_file(target: &Path, link: &Path) {
        symlink(target, link).unwrap();
    }
    pub fn assert_private(path: &Path) {
        let mode = std::fs::metadata(path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "{}", path.display());
    }
}
