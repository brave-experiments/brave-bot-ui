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

The replacement helper accepts only `.bravebot-ui/bots/*.md`, checks the expected previous
text, and writes private regular files. This protects the outside-file boundary; it does
not claim to lock out another editor that concurrently changes the same authorized file.
Previews never send content to a model. Attachment selection still requires the native
picker and a separate Send action.

The file and attachment regression tests exercise these boundaries through the actual helper.
