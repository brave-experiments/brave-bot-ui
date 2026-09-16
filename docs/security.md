# Security boundaries

The UI uses the agent's existing library interfaces without modifying the pinned
upstream source. The bridge is a separate `bravebot-rpc` child process, speaking
newline-delimited JSON over pipes. Electron's main process manages its lifetime;
window close and app quit explicitly stop the bridge. A renderer-only crash does
not itself close the pipe: there is currently no `render-process-gone` handler, so
a pending decision may remain waiting until the window closes or the app quits.
A closed stdout alone also does not trigger shutdown in the current transport;
its write errors are ignored. Neither condition grants an approval.

## Renderer and IPC

The main window enables `contextIsolation` and `sandbox`, disables `nodeIntegration`
and `webviewTag`, and rejects in-window navigation. External links open through the
system browser. The preload exposes specific IPC operations and subscriptions,
not general Node or filesystem access. The main process allow-lists agent methods.

Project-file operations use a session handle and a relative path. Main-process
code resolves the session root and validates the path. Text previews and memory
operations use the descriptor-based `bravebot-ui-files` helper; directory listing
and opening files in an external app use separate validation in `src/main/files.ts`.
See [file access and retention](file-access-security.md) for the helper's guarantees
and limits. Do not assume every filesystem operation uses the helper.

File contents **do** cross IPC for previews and bot-memory editing. These operations
do not themselves send the contents to a model. File attachments require a native
picker, a session-bound grant, validation at send time, and an explicit Send action.
The main process strips raw `files` and `dropped` lists from renderer turn requests
and composes authorized paths itself. Bot briefings are also composed by the main process.

## Decisions and refusal

The transcript presents write, command, command-output, path-vouch and user-question
requests. Replies must match both the pending request ID and its kind. Within a turn, an unknown
or consumed ID cannot approve another request. Clients discard pending questions
when a turn ends because IDs may recur in later turns. Malformed decisions decline;
question answers are checked against the offered choices.

Cancellation wakes pending questions and refuses them. Session close and bridge
shutdown also refuse outstanding questions. There is no timeout that grants approval.
These properties depend on both bridge refusal handling and Electron lifetime handling;
they are covered by the Rust refusal suites and Electron tests in [testing](testing.md).

The v0.8.0 agent also has fetch-host, language-server and manifest-plan approvals.
The UI does not present those requests yet; the bridge refuses them without taking
an answer intended for another pending question.

Command-output content is released for display so the person deciding can read it.
Only the agent's approved path admits it to the planner. Confined material is labelled
in the UI; showing it is not evidence that the planner read it. Not every write needs
a prompt: the agent's integrity policy determines that, including for bot memory.
See [memory write policy](interface.md#what-a-memory-write-is-actually-gated-on).

The bridge protocol and its implementation references are in
[phase-0-rpc-protocol.md](phase-0-rpc-protocol.md). File retention is local storage,
not encryption or a guarantee of secure erasure.
