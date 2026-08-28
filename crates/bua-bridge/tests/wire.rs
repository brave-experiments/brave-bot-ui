//! The protocol's type table, checked.
//!
//! Cheap tests over pure functions, but two of them are load-bearing: the one that says
//! only "approve" approves, and the one that says the prose is not the contract. Both
//! guard against a change that would look like a tidy-up.

use bua_agent::confirm::{Decision, Intent, WriteRequest};
use bua_agent::conversation::Said;
use bua_agent::diff::Change;
use bua_agent::report::{Activity, Landing, Phase, Reach, Shown};
use bua_bridge::wire;
use bua_core::todo::{Row, Status};
use serde_json::json;

#[test]
fn every_enum_has_the_tag_the_protocol_promises() {
    assert_eq!(wire::intent(Intent::Create), "create");
    assert_eq!(wire::intent(Intent::Overwrite), "overwrite");
    assert_eq!(wire::intent(Intent::Edit), "edit");

    assert_eq!(wire::phase(Phase::Planning), "planning");
    assert_eq!(wire::phase(Phase::Thinking), "thinking");
    assert_eq!(wire::phase(Phase::Compacting), "compacting");
    assert_eq!(wire::phase(Phase::Reconnecting), "reconnecting");

    assert_eq!(wire::reach(Reach::NotThePlanner), "not_the_planner");
    assert_eq!(wire::reach(Reach::NoModel), "no_model");

    assert_eq!(wire::landing(Landing::Context), "context");
    assert_eq!(wire::landing(Landing::Quarantined), "quarantined");
    assert_eq!(wire::landing(Landing::Reserved), "reserved");

    assert_eq!(wire::status(Status::Pending), "pending");
    assert_eq!(wire::status(Status::Active), "active");
    assert_eq!(wire::status(Status::Done), "done");
}

/// The wording upstream writes for a screen is not what goes on the wire.
///
/// If someone ever "simplifies" this by sending `describe()`, the client ends up matching
/// on a sentence, and a sentence that merely mentions a refusal becomes one.
#[test]
fn a_tag_is_sent_rather_than_the_sentence_meant_for_a_screen() {
    for landing in [Landing::Context, Landing::Quarantined, Landing::Reserved] {
        assert_ne!(wire::landing(landing), landing.describe());
        assert!(!wire::landing(landing).contains(' '), "a tag has no spaces");
    }
    for reach in [Reach::NotThePlanner, Reach::NoModel] {
        assert_ne!(wire::reach(reach), reach.describe());
        assert!(!wire::reach(reach).contains(' '), "a tag has no spaces");
    }
}

/// The single most important line in this file.
#[test]
fn only_the_exact_word_approve_approves() {
    assert_eq!(wire::decision(&json!("approve")), Decision::Approve);

    // Everything else, in every shape a client could get it wrong in.
    for wrong in [
        json!("reject"),
        json!("Approve"),
        json!("APPROVE"),
        json!(" approve"),
        json!("approve "),
        json!("approved"),
        json!("yes"),
        json!("ok"),
        json!(true),
        json!(1),
        json!(null),
        json!({}),
        json!([]),
        json!(""),
    ] {
        assert_eq!(
            wire::decision(&wrong),
            Decision::Reject,
            "{wrong} must not approve a write"
        );
    }
}

#[test]
fn an_elided_run_carries_its_length_rather_than_empty_text() {
    assert_eq!(
        wire::change(&Change::Elided(40)),
        json!({ "kind": "elided", "lines": 40 })
    );
    assert_eq!(
        wire::change(&Change::Added("  let x = 2;".into())),
        json!({ "kind": "added", "text": "  let x = 2;" })
    );
}

/// A running call and a finished-with-nothing-to-say call must be tellable apart.
#[test]
fn a_running_call_sends_an_explicit_null_note() {
    let running = wire::activity(&Activity::running("read", "src/main.rs"));
    assert_eq!(running["note"], json!(null));
    assert!(
        running.as_object().expect("an object").contains_key("note"),
        "the key must be present and null, not absent"
    );

    let finished = wire::activity(&Activity::running("read", "src/main.rs").done("412 lines"));
    assert_eq!(finished["note"], json!("412 lines"));
    assert_eq!(finished["failed"], json!(false));

    let refused = wire::activity(&Activity::running("write", "x").failed("refused"));
    assert_eq!(refused["failed"], json!(true));
}

#[test]
fn quarantined_content_says_how_much_it_left_out() {
    let value = wire::shown(&Shown {
        origin: "https://example.com/page".into(),
        reach: Reach::NotThePlanner,
        label: "(U,priv)".into(),
        preview: vec!["first line".into()],
        lines: 240,
    });
    assert_eq!(value["reach"], json!("not_the_planner"));
    assert_eq!(value["lines"], json!(240));
    assert_eq!(value["preview"], json!(["first line"]));
}

#[test]
fn a_replayed_tool_line_carries_no_outcome() {
    let value = wire::said(&Said::Tool("read(src/main.rs)".into()));
    assert_eq!(value["kind"], json!("tool"));
    let keys: Vec<&String> = value.as_object().expect("an object").keys().collect();
    assert_eq!(keys, vec!["kind", "text"], "nothing to imply a result");

    assert_eq!(wire::said(&Said::User("hi".into()))["kind"], json!("user"));
    assert_eq!(
        wire::said(&Said::Assistant("hello".into()))["kind"],
        json!("assistant")
    );
}

#[test]
fn a_todo_row_sends_its_status_not_its_glyph() {
    let value = wire::row(&Row {
        content: "fix the parser".into(),
        marker: "[x]",
        status: Status::Done,
    });
    assert_eq!(value, json!({ "content": "fix the parser", "status": "done" }));
}

/// The body never goes on the wire. A reviewer reads a diff; shipping `contents` invites
/// a front-end to show the whole file instead, which is the thing the design avoids.
#[test]
fn a_write_request_sends_the_diff_and_never_the_body() {
    let request = WriteRequest {
        path: "src/parser.rs".into(),
        contents: "line one\nSECRET BODY\nline three\n".into(),
        existing: Some("line one\nline two\nline three\n".into()),
        intent: Intent::Edit,
        untrusted: false,
    };

    let value = wire::write_request(3, &request);
    let text = value.to_string();

    assert!(
        !text.contains("SECRET BODY\\nline three"),
        "the complete body must not be serialised"
    );
    assert_eq!(value["request"], json!(3));
    assert_eq!(value["path"], json!("src/parser.rs"));
    assert_eq!(value["intent"], json!("edit"));
    assert_eq!(value["existing"], json!(true), "something would be lost");
    assert_eq!(value["untrusted"], json!(false));
    assert_eq!(value["added"], json!(1));
    assert_eq!(value["removed"], json!(1));

    // The changed line is there, because that is what a reviewer reads.
    assert!(text.contains("SECRET BODY"), "the diff shows the new line");
}

#[test]
fn a_created_file_says_nothing_would_be_lost() {
    let value = wire::write_request(
        1,
        &WriteRequest {
            path: "new.md".into(),
            contents: "hello\n".into(),
            existing: None,
            intent: Intent::Create,
            untrusted: true,
        },
    );
    assert_eq!(value["existing"], json!(false));
    assert_eq!(value["intent"], json!("create"));
    assert_eq!(
        value["untrusted"], json!(true),
        "a front-end must be able to draw this differently"
    );
}
