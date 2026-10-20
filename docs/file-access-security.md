# UI file access and retention

Project text previews, attachment validation, and bot-memory reads and edits use
`bravebot-ui-files`, a helper built and packaged by this repository. It is independent of
the brave-bot submodule. Only Electron's main process supplies its project root and path;
the renderer cannot choose a helper executable or send a shell command.

The helper opens each directory component with `openat`, `O_DIRECTORY`, and `O_NOFOLLOW`,
starting from the filesystem root. Reads use the pinned parent descriptor. Memory edits
create an exclusive temporary file and use `renameat` within the pinned parent directory.
Replacing a path component with a symlink therefore cannot redirect a later operation.
An operation already holding a directory descriptor stays on that authorized directory
even if its name changes. Symlinked project paths are refused, except for macOS's fixed
`/tmp` and `/var` aliases. Read sizes, request sizes, helper runtime and output are bounded.

On Windows the helper does the same with `NtCreateFile` relative to a held directory
handle, starting from the root of the drive or network share; a device path such as
`\\.\` or `\\?\GLOBALROOT` is refused. Each entry is opened
as itself: a symlink, junction or mount point is refused, and any other reparse point,
such as a cloud placeholder, is reopened through its filter and kept only if both handles
are the same file. Renames resolve the new name against the held handle. A `:` in a name is
refused so no request reaches an alternate data stream.

An SMB share weakens this on every platform: a mapped drive or `\\server\share` on
Windows, an `smbfs` or `cifs` mount on macOS or Linux. SMB opens a file by its path from the
share, not relative to a held handle, so the server resolves every name again. A link already
in place is still refused, but a directory swapped during an operation for a link the server
follows itself, such as a junction on a Windows server, redirects that operation without the
client seeing it. A project on a share is only as safe as the server and everyone who can
write to it.

The replacement helper accepts only `.bravebot-ui/bots/*.md`, checks the expected previous
text, and writes private regular files: mode 0600 on Unix, and on Windows a protected
access list naming only the current account, supplied as the file is created. A server may
not know this computer's account, so on a Windows network share a new file takes the share's
inherited access list instead, as an SMB mount on Unix usually ignores the mode. This protects the outside-file boundary; it does
not claim to lock out another editor that concurrently changes the same authorized file.
Previews never send content to a model. Attachment selection still requires the native
picker and a separate Send action.

Drafts are stored locally in `experience.json` with mode 0600; clearing a draft removes
its saved text. Node ignores that mode on Windows, so there drafts and memory history are
written through the helper with the same access list. Memory history retains up to 30 revisions. Reset preserves revisions for
recovery, as stated in its confirmation. Deleting a bot removes its app-owned revision
history and cached briefing, but keeps project memory files and saved conversations.
Deletion errors are surfaced, and deletion is refused while a bot's conversation is running.
These are local files, not encrypted storage or a promise of secure erasure from backups.

Regression coverage includes parent-directory swaps for reads and writes, root and leaf
symlinks, traversal, size bounds, stale edits, file permissions, removal and bot recreation,
and actual IPC in a packaged app. See [testing.md](testing.md) for reproduction commands.
