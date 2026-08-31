# Agent notes

This is a desktop interface to `bravebot`. The agent is a sibling checkout named `bravebot`,
never this repository, and it is never modified. The window talks to `bravebot-rpc` over a
narrow JSON protocol; the renderer has no Node, no filesystem, and no channel that answers
an approval.

Do not call `app.setName`. `userData` is derived from `app.name`, and renaming the app
orphans `bravebot-ui.json`.

## Cursor Cloud specific instructions

Cloud Agents run on Ubuntu. This app is a window: hosted agents can drive it after the
Linux chrome in `src/main/index.ts` and `scripts/with-display.sh`. They cannot film a demo
(`screencapture` is macOS) and they should not send a live prompt unless Cloud Secrets
already export `SERVICES_KEY_AICHAT`.

`.cursor/environment.json` runs `scripts/cloud-install.sh` on each Build. That script
installs Electron's GTK/NSS libraries and Xvfb, puts Rust 1.88 and Node 22 on the machine,
and makes a sibling directory **named `bravebot`**. GitHub's repository is `brave-bot`;
`crates/bravebot-bridge/Cargo.toml` path-depends on `../../../bravebot/crates/*`. Setting
`BRAVEBOT_DIR` is not enough for Cargo. If a multi-repo environment already cloned
`brave-bot` next to this checkout, the script symlinks it; otherwise it clones
`brave-experiments/brave-bot` into `../bravebot`.

Credentials are Cloud Secrets, not `.envrc`. There is no interactive `direnv allow` on the
VM. `SERVICES_KEY_AICHAT` and `BRAVE_SERVICES_KEY_ID` are what a live turn needs; without
them the binary still lists sessions.

If Electron dies at launch, `ldd node_modules/electron/dist/electron` is the first thing to
run. A missing `.so` is a failed install, not a Playwright bug.

### What to run

The cheap suite, in this order. `with-display.sh` supplies Xvfb when `$DISPLAY` is empty.

```
npm run typecheck
cargo test -p bravebot-bridge
npm run drive
npm run drive:menu
npm run drive:resize
npm run drive:columns
npm run drive:panels
npm run drive:tree
npm run drive:export
npm run drive:fork
```

`npm run package` then `npm run drive:packaged` after that, if the cheap suite is green.

Do not run `npm run demo` or `npm run demo -- --record`. Do not run `drive:run`,
`drive:ask`, `drive:markdown`, `scripts/drive-turn.mjs`, or `scripts/smoke-turn.sh` unless
`SERVICES_KEY_AICHAT` is set — those spend tokens.

Paste failing assertion lines rather than paraphrasing them.
