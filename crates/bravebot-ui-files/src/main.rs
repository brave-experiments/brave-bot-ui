//! UI-only file access. Never executes commands or sends content to the agent.
//! Every path component is opened relative to a pinned directory, without following links.
#![cfg_attr(not(windows), forbid(unsafe_code))]
#![cfg_attr(windows, deny(unsafe_code))]

#[cfg(unix)]
#[path = "unix.rs"]
mod sys;
#[cfg(windows)]
#[path = "windows.rs"]
mod sys;

use serde::Deserialize;
use serde_json::{Value, json};
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Component, Path};

#[derive(Deserialize)]
struct Request {
    root: String,
    path: String,
    operation: String,
    limit: Option<usize>,
    text: Option<String>,
    expected: Option<String>,
}

/// Memory history keeps at most 30 revisions, each at most 64 KB, so about 2 MB in all. The
/// limit is twice that, to leave room for JSON escaping.
const PRIVATE_LIMIT: usize = 4 * 1024 * 1024;

fn invalid(message: &str) -> io::Error {
    io::Error::other(message)
}
fn components(path: &Path) -> io::Result<Vec<&str>> {
    path.components()
        .map(|part| match part {
            Component::Normal(value) => value.to_str().ok_or_else(|| invalid("Invalid path")),
            _ => Err(invalid("Only relative file names are allowed")),
        })
        .collect()
}
fn root_directory(root: &str) -> io::Result<File> {
    let root = Path::new(root);
    if !root.is_absolute() {
        return Err(invalid("Project root must be absolute"));
    }
    let (mut directory, rest) = sys::volume_root(root)?;
    for part in components(rest)? {
        directory = sys::open_directory(&directory, part, false)?;
    }
    Ok(directory)
}
fn parent_directory(root: &str, path: &str, create: bool) -> io::Result<(File, String)> {
    let parts = components(Path::new(path))?;
    let (leaf, parents) = parts
        .split_last()
        .ok_or_else(|| invalid("A file name is required"))?;
    let mut directory = root_directory(root)?;
    for part in parents {
        directory = sys::open_directory(&directory, part, create)?;
    }
    Ok((directory, (*leaf).to_string()))
}
fn read_at(parent: &File, leaf: &str, limit: usize) -> io::Result<(String, bool)> {
    let file = sys::open_file(parent, leaf)?;
    if !file.metadata()?.is_file() {
        return Err(invalid("Not a regular file"));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.contains(&0) {
        return Err(invalid("Not a text file"));
    }
    let truncated = bytes.len() > limit;
    bytes.truncate(limit);
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}
fn replace_at(
    parent: &File,
    leaf: &str,
    text: &str,
    expected: Option<&str>,
) -> io::Result<Option<String>> {
    let previous = match read_at(parent, leaf, 65536) {
        Ok((_, true)) => return Err(invalid("File exceeds 64 KB")),
        Ok((text, false)) => Some(text),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    if previous.as_deref() != expected {
        return Err(invalid(
            "File changed since this editor opened. Reopen it to review the latest version.",
        ));
    }
    write_private(parent, leaf, text)?;
    Ok(previous)
}
/// Replaces `leaf` with a new private file. The text goes into a temporary file first, so `leaf`
/// is never left half-written.
fn write_private(parent: &File, leaf: &str, text: &str) -> io::Result<()> {
    let temporary = format!(
        ".memory-{}-{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| invalid("Invalid clock"))?
            .as_nanos()
    );
    let mut file = sys::create_private(parent, &temporary)?;
    let result = (|| {
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        sys::rename(parent, &temporary, leaf)
    })();
    if result.is_err() {
        drop(file);
        let _ = sys::remove(parent, &temporary);
    }
    result
}
fn handle(request: Request) -> io::Result<Value> {
    match request.operation.as_str() {
        "read" => {
            let limit = request.limit.unwrap_or(131072).min(262144);
            let (parent, leaf) = parent_directory(&request.root, &request.path, false)?;
            let (text, truncated) = read_at(&parent, &leaf, limit)?;
            Ok(json!({"text": text, "truncated": truncated}))
        }
        "hooks.read" | "hooks.replace" => {
            if request.path != "hooks.json" {
                return Err(invalid("Only the hooks file is allowed"));
            }
            let (parent, leaf) = parent_directory(&request.root, "hooks.json", false)?;
            if request.operation == "hooks.read" {
                return match read_at(&parent, &leaf, 65536) {
                    Ok((_, true)) => Err(invalid("Hooks exceed 64 KB")),
                    Ok((text, false)) => Ok(json!({"text": text})),
                    Err(error) if error.kind() == io::ErrorKind::NotFound => {
                        Ok(json!({"text": null}))
                    }
                    Err(error) => Err(error),
                };
            }
            let text = request.text.ok_or_else(|| invalid("Missing hooks"))?;
            if text.len() > 65536 || text.contains('\0') {
                return Err(invalid("Hooks must be text under 64 KB"));
            }
            let previous = replace_at(&parent, &leaf, &text, request.expected.as_deref())?;
            Ok(json!({"previous": previous}))
        }
        "replace" => {
            // This channel writes only bot memory, never an arbitrary project file.
            let parts = components(Path::new(&request.path))?;
            if parts.len() != 3
                || parts[0] != ".bravebot-ui"
                || parts[1] != "bots"
                || !parts[2].ends_with(".md")
            {
                return Err(invalid("Only bot memory can be replaced"));
            }
            let text = request.text.ok_or_else(|| invalid("Missing memory"))?;
            if text.len() > 65536 || text.contains('\0') {
                return Err(invalid("Memory must be text under 64 KB"));
            }
            let (parent, leaf) = parent_directory(&request.root, &request.path, true)?;
            let previous = replace_at(&parent, &leaf, &text, request.expected.as_deref())?;
            Ok(json!({"previous": previous}))
        }
        "private.write" => {
            // The app's own files, such as drafts. Node ignores the file mode on Windows, so the
            // app writes them through here. The request names one file, in a folder the app chose.
            let [name] = components(Path::new(&request.path))?[..] else {
                return Err(invalid("Only a single file name is allowed"));
            };
            let text = request.text.ok_or_else(|| invalid("Missing text"))?;
            if text.len() > PRIVATE_LIMIT || text.contains('\0') {
                return Err(invalid("Private files must be text under 4 MB"));
            }
            write_private(&root_directory(&request.root)?, name, &text)?;
            Ok(json!({}))
        }
        _ => Err(invalid("Unknown file operation")),
    }
}
fn main() {
    let result = (|| {
        let mut input = String::new();
        io::stdin()
            .take(2 * PRIVATE_LIMIT as u64)
            .read_to_string(&mut input)?;
        let request = serde_json::from_str(&input).map_err(|_| invalid("Invalid request"))?;
        handle(request)
    })();
    let response = match result {
        Ok(value) => json!({"ok": value}),
        Err(error) => json!({"error": error.to_string()}),
    };
    println!("{response}");
}

#[cfg(test)]
mod tests {
    use super::sys::testing::{assert_private, link_directory, link_file};
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    struct Fixture {
        path: PathBuf,
        _directory: tempfile::TempDir,
    }
    impl Fixture {
        fn new() -> Self {
            let mut builder = tempfile::Builder::new();
            builder.prefix("bravebot-safe-files-");
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                builder.permissions(fs::Permissions::from_mode(0o700));
            }
            let directory = builder.tempdir().unwrap();
            // Normalize macOS's system temp alias before no-follow traversal.
            // On Windows, keep the drive-letter path: `canonicalize` would give a `\\?\` path,
            // and in those `/` does not separate folders.
            #[cfg(unix)]
            let path = fs::canonicalize(directory.path()).unwrap();
            #[cfg(windows)]
            let path = directory.path().to_path_buf();
            Self {
                path,
                _directory: directory,
            }
        }
        fn root(&self) -> &str {
            self.path.to_str().unwrap()
        }
    }

    #[test]
    fn preview_stays_on_the_pinned_directory_when_its_parent_is_replaced() {
        let f = Fixture::new();
        fs::create_dir(f.path.join("folder")).unwrap();
        fs::create_dir(f.path.join("outside")).unwrap();
        fs::write(f.path.join("folder/file"), "inside").unwrap();
        fs::write(f.path.join("outside/file"), "private outside").unwrap();
        let (parent, leaf) = parent_directory(f.root(), "folder/file", false).unwrap();
        fs::rename(f.path.join("folder"), f.path.join("original")).unwrap();
        link_directory(&f.path.join("outside"), &f.path.join("folder"));
        assert_eq!(read_at(&parent, &leaf, 100).unwrap().0, "inside");
        assert!(parent_directory(f.root(), "folder/file", false).is_err());
    }

    #[test]
    fn memory_replace_cannot_follow_a_swapped_parent_to_an_outside_file() {
        let f = Fixture::new();
        let path = ".bravebot-ui/bots/test.md";
        let (parent, leaf) = parent_directory(f.root(), path, true).unwrap();
        replace_at(&parent, &leaf, "before", None).unwrap();
        fs::create_dir(f.path.join("outside")).unwrap();
        fs::write(f.path.join("outside/test.md"), "outside sentinel").unwrap();
        fs::rename(f.path.join(".bravebot-ui/bots"), f.path.join("original")).unwrap();
        link_directory(&f.path.join("outside"), &f.path.join(".bravebot-ui/bots"));
        replace_at(&parent, &leaf, "edited", Some("before")).unwrap();
        assert_eq!(
            fs::read_to_string(f.path.join("outside/test.md")).unwrap(),
            "outside sentinel"
        );
        assert_eq!(
            fs::read_to_string(f.path.join("original/test.md")).unwrap(),
            "edited"
        );
        assert!(parent_directory(f.root(), path, true).is_err());
    }

    #[test]
    fn a_symlink_replacing_the_root_or_leaf_is_refused() {
        let f = Fixture::new();
        fs::create_dir(f.path.join("project")).unwrap();
        fs::write(f.path.join("secret"), "outside").unwrap();
        link_file(&f.path.join("secret"), &f.path.join("project/file"));
        let (parent, leaf) = parent_directory(f.root(), "project/file", false).unwrap();
        assert!(read_at(&parent, &leaf, 100).is_err());
        assert!(replace_at(&parent, &leaf, "changed", None).is_err());
        link_directory(&f.path, &f.path.join("linked-root"));
        assert!(root_directory(f.path.join("linked-root").to_str().unwrap()).is_err());
        assert_eq!(
            fs::read_to_string(f.path.join("secret")).unwrap(),
            "outside"
        );
    }

    #[test]
    fn replacement_checks_expected_text_and_creates_a_private_regular_file() {
        let f = Fixture::new();
        let (parent, leaf) = parent_directory(f.root(), ".bravebot-ui/bots/test.md", true).unwrap();
        replace_at(&parent, &leaf, "before", None).unwrap();
        assert!(replace_at(&parent, &leaf, "wrong", None).is_err());
        assert_eq!(
            replace_at(&parent, &leaf, "after", Some("before")).unwrap(),
            Some("before".into())
        );
        assert_eq!(read_at(&parent, &leaf, 100).unwrap().0, "after");
        assert_private(&f.path.join(".bravebot-ui/bots/test.md"));
        assert_eq!(
            fs::read_dir(f.path.join(".bravebot-ui/bots"))
                .unwrap()
                .count(),
            1
        );
    }

    #[test]
    fn traversal_nonregular_binary_and_oversized_reads_are_bounded() {
        let f = Fixture::new();
        for path in ["../secret", "/etc/passwd", "", "a/../../secret"] {
            assert!(parent_directory(f.root(), path, false).is_err());
        }
        fs::write(f.path.join("binary"), b"a\0b").unwrap();
        fs::write(f.path.join("large"), "123456").unwrap();
        let parent = root_directory(f.root()).unwrap();
        assert!(read_at(&parent, "binary", 100).is_err());
        assert_eq!(read_at(&parent, "large", 3).unwrap(), ("123".into(), true));
        fs::create_dir(f.path.join("directory")).unwrap();
        assert!(read_at(&parent, "directory", 100).is_err());
        assert!(read_at(&parent, "bad\0name", 100).is_err());
    }

    #[test]
    fn exclusive_temporary_creation_refuses_existing_files_and_links() {
        let f = Fixture::new();
        fs::write(f.path.join("existing"), "sentinel").unwrap();
        link_file(&f.path.join("existing"), &f.path.join("link"));
        let parent = root_directory(f.root()).unwrap();
        for leaf in ["existing", "link"] {
            assert!(sys::create_private(&parent, leaf).is_err());
        }
        assert_eq!(
            fs::read_to_string(f.path.join("existing")).unwrap(),
            "sentinel"
        );
    }

    #[test]
    fn a_one_character_file_name_can_be_replaced() {
        let f = Fixture::new();
        let parent = root_directory(f.root()).unwrap();
        replace_at(&parent, "b", "first", None).unwrap();
        replace_at(&parent, "b", "second", Some("first")).unwrap();
        assert_eq!(fs::read_to_string(f.path.join("b")).unwrap(), "second");
        assert_eq!(fs::read_dir(&f.path).unwrap().count(), 1);
    }

    #[test]
    fn private_writes_replace_one_named_file_and_nothing_else() {
        let f = Fixture::new();
        fs::create_dir(f.path.join("state")).unwrap();
        let write = |path: &str, text: &str| {
            handle(Request {
                root: f.root().into(),
                path: path.into(),
                operation: "private.write".into(),
                limit: None,
                text: Some(text.into()),
                expected: None,
            })
        };
        write("drafts.json", "first").unwrap();
        write("drafts.json", "second").unwrap();
        assert_eq!(
            fs::read_to_string(f.path.join("drafts.json")).unwrap(),
            "second"
        );
        assert_private(&f.path.join("drafts.json"));
        for path in ["state/drafts.json", "../drafts.json", "", "bad\0name"] {
            assert!(write(path, "text").is_err(), "{path:?}");
        }
        assert!(write("big.json", &"x".repeat(PRIVATE_LIMIT + 1)).is_err());
        let names: Vec<_> = fs::read_dir(&f.path)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(fs::read_dir(f.path.join("state")).unwrap().next().is_none());
    }

    #[cfg(windows)]
    #[test]
    fn a_junction_in_place_of_a_directory_is_refused() {
        let f = Fixture::new();
        fs::create_dir(f.path.join("outside")).unwrap();
        fs::write(f.path.join("outside/file"), "private outside").unwrap();
        sys::testing::junction(&f.path.join("outside"), &f.path.join("folder"));
        assert!(parent_directory(f.root(), "folder/file", false).is_err());
        assert!(parent_directory(f.root(), "folder/new.md", true).is_err());
        assert!(root_directory(f.path.join("folder").to_str().unwrap()).is_err());
        assert!(!f.path.join("outside/new.md").exists());
    }

    #[cfg(windows)]
    #[test]
    fn roots_are_drives_or_shares_and_names_cannot_reach_a_stream() {
        let f = Fixture::new();
        fs::write(f.path.join("file.txt"), "text").unwrap();
        for root in [
            r"\\.\C:\",
            r"\\?\GLOBALROOT\Device\HarddiskVolume1\",
            r"\\?\UNC\\share\project",
            r"\\?\UNC\server/other\share\project",
            r"\\..\share\project",
            r"C:relative",
            r"\project",
        ] {
            assert!(root_directory(root).is_err(), "{root}");
        }
        assert!(root_directory(&format!(r"\\?\{}", f.root())).is_ok());
        let parent = root_directory(f.root()).unwrap();
        assert!(read_at(&parent, "file.txt:hidden", 100).is_err());
        assert!(sys::create_private(&parent, "file.txt:hidden").is_err());
        assert!(parent_directory(f.root(), r"C:\Windows\win.ini", false).is_err());
    }

    /// Unlike the drive tests, this does not swap in a link partway through: over SMB the
    /// server follows a junction itself, so the helper cannot refuse it.
    #[cfg(windows)]
    #[test]
    #[ignore = r"needs \\localhost\C$, this computer's own administrative share"]
    fn a_share_refuses_links_like_a_drive_and_new_files_take_its_access_list() {
        for verbatim in [false, true] {
            let f = Fixture::new();
            fs::write(f.path.join("file.txt"), "text").unwrap();
            fs::create_dir(f.path.join("outside")).unwrap();
            fs::write(f.path.join("outside/file"), "private outside").unwrap();
            sys::testing::junction(&f.path.join("outside"), &f.path.join("joined"));
            link_directory(&f.path.join("outside"), &f.path.join("linked"));
            let share = sys::testing::loopback_share(f.root());
            let root = if verbatim {
                share.replacen(r"\\", r"\\?\UNC\", 1)
            } else {
                share
            };
            for path in ["joined/file", "linked/file"] {
                assert!(
                    parent_directory(&root, path, false).is_err(),
                    "{root}: {path}"
                );
            }
            let (parent, leaf) = parent_directory(&root, "file.txt", false).unwrap();
            assert_eq!(read_at(&parent, &leaf, 100).unwrap().0, "text");
            let path = ".bravebot-ui/bots/test.md";
            let (parent, leaf) = parent_directory(&root, path, true).unwrap();
            replace_at(&parent, &leaf, "memory", None).unwrap();
            assert_eq!(fs::read_to_string(f.path.join(path)).unwrap(), "memory");
            for created in [f.path.join(path), f.path.join(".bravebot-ui")] {
                let list = sys::testing::access_list(&created);
                assert!(
                    !list.starts_with("D:P") && list.contains("ID;"),
                    "{root}: {list}"
                );
            }
        }
    }
}

#[cfg(test)]
mod hooks_tests {
    use super::*;
    use std::fs;
    #[test]
    fn hooks_channel_only_replaces_its_fixed_file_and_preserves_concurrent_edits() {
        let mut builder = tempfile::Builder::new();
        builder.prefix("bravebot-hook-helper-");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            builder.permissions(std::fs::Permissions::from_mode(0o700));
        }
        let directory = builder.tempdir().unwrap();
        // Normalize the system temp alias before the helper's no-follow traversal.
        let root = fs::canonicalize(directory.path()).unwrap();
        let call = |operation: &str, path: &str, text: Option<&str>, expected: Option<&str>| {
            handle(Request {
                root: root.display().to_string(),
                path: path.into(),
                operation: operation.into(),
                limit: None,
                text: text.map(str::to_string),
                expected: expected.map(str::to_string),
            })
        };
        assert!(call("hooks.read", "hooks.json", None, None).unwrap()["text"].is_null());
        assert!(call("hooks.replace", "other.json", Some("{}"), None).is_err());
        assert!(call("hooks.replace", "hooks.json", Some("first"), None).is_ok());
        assert!(call("hooks.replace", "hooks.json", Some("overwrite"), None).is_err());
        assert_eq!(
            fs::read_to_string(root.join("hooks.json")).unwrap(),
            "first"
        );
    }
}
