//! Reading requests off the wire, and what happens when they are wrong.

use bravebot_bridge::protocol::{ErrorCode, Event, Failure, Request, Unreadable, response};
use serde_json::json;

#[test]
fn a_well_formed_request_parses() {
    let request = Request::parse(r#"{"id":7,"method":"session.open","params":{"id":"abc"}}"#)
        .expect("should parse");
    assert_eq!(request.id, 7);
    assert_eq!(request.method, "session.open");
    assert_eq!(request.string("id").expect("present"), "abc");
}

/// Several methods take nothing. Making them send `{}` is ceremony.
#[test]
fn absent_params_read_as_an_empty_object() {
    let request = Request::parse(r#"{"id":1,"method":"agent.info"}"#).expect("should parse");
    assert_eq!(request.params, json!({}));
    assert!(request.optional_string("directory").is_none());
}

/// A bad line with a recoverable id can be answered. One without cannot: the front-end is
/// waiting on a number nobody knows, and inventing one would answer the wrong request.
#[test]
fn a_bad_line_is_answerable_only_when_the_id_survived() {
    match Request::parse(r#"{"id":9,"params":{}}"#) {
        Err(Unreadable::Answerable { id, failure }) => {
            assert_eq!(id, 9);
            assert_eq!(failure.code, ErrorCode::BadRequest);
        }
        other => panic!("expected an answerable failure, got {other:?}"),
    }

    for hopeless in [
        r#"not json at all"#,
        r#"{"method":"agent.info"}"#,
        r#"{"id":"seven","method":"agent.info"}"#,
        r#"[]"#,
    ] {
        assert!(
            matches!(Request::parse(hopeless), Err(Unreadable::Unanswerable { .. })),
            "{hopeless} should be unanswerable"
        );
    }
}

#[test]
fn a_missing_parameter_names_itself() {
    let request = Request::parse(r#"{"id":1,"method":"session.open","params":{}}"#).expect("parses");
    let failure = request.string("directory").expect_err("should fail");
    assert_eq!(failure.code, ErrorCode::BadRequest);
    assert!(failure.message.contains("directory"), "{}", failure.message);
}

#[test]
fn a_response_carries_ok_or_error_but_never_both() {
    let ok = response(1, Ok(json!({ "a": 1 })));
    assert_eq!(ok["id"], json!(1));
    assert!(ok.get("error").is_none());

    let bad = response(2, Err(Failure::no_such_session()));
    assert_eq!(bad["error"]["code"], json!("no_such_session"));
    assert!(bad.get("ok").is_none());
}

#[test]
fn only_a_global_event_may_omit_its_session() {
    let scoped = Event::new("phase", "s1", json!({ "phase": "planning" })).to_value();
    assert_eq!(scoped["session"], json!("s1"));
    assert_eq!(scoped["event"], json!("phase"));
    assert!(scoped.get("id").is_none(), "an event is not a response");

    let global = Event::global("agent.ready", json!({})).to_value();
    assert!(global.get("session").is_none());
}

#[test]
fn every_error_code_has_a_distinct_wire_name() {
    let codes = [
        ErrorCode::BadRequest,
        ErrorCode::NoSuchSession,
        ErrorCode::NoSuchRequest,
        ErrorCode::TurnInFlight,
        ErrorCode::NotADirectory,
        ErrorCode::NoHome,
        ErrorCode::Config,
        ErrorCode::Internal,
    ];
    let mut names: Vec<&str> = codes.iter().map(|c| c.as_str()).collect();
    names.sort_unstable();
    let count = names.len();
    names.dedup();
    assert_eq!(names.len(), count, "two codes share a wire name");
}
