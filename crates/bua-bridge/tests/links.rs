//! Step 0: proving the zero-change constraint holds.
//!
//! This crate depends on brave-user-agent's crates without modifying them. That claim
//! rests on every module the bridge needs already being `pub`, and it is worth an actual
//! test rather than a sentence in a document: if an upstream rev makes one of them
//! private, this fails at the point the dependency is bumped instead of somewhere deep
//! in a feature later.

/// The agent stamps its build into every session record, and the bridge must be able to
/// read the same one.
#[test]
fn the_agent_build_is_reachable() {
    let build = bua_bridge::agent_build();
    assert!(!build.is_empty(), "the agent reported no build string");
    // `crates/tui/build.rs` falls back to "(no git)" for a vendored or tarball build, so
    // the version is the only part that is always there.
    assert!(
        build.starts_with(char::is_numeric),
        "expected a version to lead the build string, got {build:?}"
    );
}

/// The three surfaces the bridge is built on. Named individually so a failure says which
/// one moved rather than that "the bridge does not compile".
#[test]
fn the_surfaces_the_bridge_needs_are_public() {
    // Sessions on disk: the left-hand column, and what a resume reads.
    let _: fn(&std::path::Path) -> Vec<bua_tui::sessions::Summary> = bua_tui::sessions::list;
    let _: fn(&std::path::Path, &str) -> Option<bua_tui::sessions::Record> = bua_tui::sessions::load;
    // Where global state lives, which is how sessions are found at all.
    let _: fn() -> Option<std::path::PathBuf> = bua_tui::store::directory;
    // The audit projection, reused verbatim rather than re-derived: two spellings of one
    // trail is exactly the drift this avoids.
    let _: fn(&bua_core::event::Event) -> serde_json::Value = bua_tui::audit::as_json;
}

/// The traits the turn engine takes its interface as. The bridge implements all three;
/// this only asserts they are nameable from outside.
#[test]
fn the_turn_engine_seams_are_public() {
    fn accepts<C: bua_agent::Confirmer, R: bua_agent::Reporter, S: bua_core::event::Sink>() {}
    accepts::<bua_agent::Unattended, bua_agent::IgnoreReports, bua_core::event::NullSink>();
}
