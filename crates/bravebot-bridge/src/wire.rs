//! Turning the agent's types into JSON, and reading answers back.
//!
//! One function per row of the protocol's type table, so the projection lives in one
//! place and a change to it is a change to one function. Pure: nothing here does I/O,
//! which is what makes the whole table testable in a few milliseconds.
//!
//! Two rules run through all of it.
//!
//! **Send the discriminant, not the prose.** [`Landing::describe`] and
//! [`Reach::describe`] return sentences meant for a screen. They are wording, they will
//! change, and a client that matches on them is matching on prose — which is how a
//! message that merely mentions a refusal becomes one. The tag is the contract; a
//! front-end may render its own words from it.
//!
//! **Unknown input degrades toward less trust.** Reading a tag we do not recognise gives
//! the more restrictive variant, never the more permissive one, mirroring what
//! `Snapshot` and `Record::trust_map` already do upstream. There is no error case for a
//! decision, because refusing to parse an answer and refusing the write it answers are
//! the same outcome and only one of them is honest about it.

use bravebot_agent::conversation::Said;
use bravebot_agent::confirm::{Decision, Intent, WriteRequest};
use bravebot_agent::diff::Change;
use bravebot_agent::report::{Activity, Landing, Phase, Reach, Shown};
use bravebot_core::todo::{Row, Status};
use serde_json::{Value, json};

/// Unchanged lines shown either side of a change, for orientation.
///
/// The same figure the terminal confirmer uses, so the two front-ends show a reviewer
/// the same amount of context and an approval means the same thing in both.
const CONTEXT_LINES: usize = 2;

// ---------------------------------------------------------------- enums, outbound

pub fn intent(intent: Intent) -> &'static str {
    match intent {
        Intent::Create => "create",
        Intent::Overwrite => "overwrite",
        Intent::Edit => "edit",
    }
}

pub fn phase(phase: Phase) -> &'static str {
    match phase {
        Phase::Planning => "planning",
        Phase::Thinking => "thinking",
        Phase::Compacting => "compacting",
        Phase::Reconnecting => "reconnecting",
    }
}

pub fn reach(reach: Reach) -> &'static str {
    match reach {
        Reach::NotThePlanner => "not_the_planner",
        Reach::NoModel => "no_model",
    }
}

pub fn landing(landing: Landing) -> &'static str {
    match landing {
        Landing::Context => "context",
        Landing::Quarantined => "quarantined",
        Landing::Reserved => "reserved",
    }
}

pub fn status(status: Status) -> &'static str {
    match status {
        Status::Pending => "pending",
        Status::Active => "active",
        Status::Done => "done",
    }
}

// ---------------------------------------------------------------- inbound

/// Read a decision the front-end sent.
///
/// Total, and deliberately so. Only the exact word "approve" approves; anything else —
/// a typo, a tag from a newer client, a null, a number — is a refusal. An approval is
/// the one thing in this protocol that must never be produced by accident, so it is the
/// one thing that gets no benefit of the doubt.
pub fn decision(value: &Value) -> Decision {
    match value.as_str() {
        Some("approve") => Decision::Approve,
        _ => Decision::Reject,
    }
}

// ---------------------------------------------------------------- structures

/// One line of a diff.
///
/// `Elided` carries a count rather than text: it stands for a run of unchanged lines
/// nobody needs to see, and giving it a `text` field would invite a client to render an
/// empty string where the agent meant "forty lines you do not care about".
pub fn change(change: &Change) -> Value {
    match change {
        Change::Kept(text) => json!({ "kind": "kept", "text": text }),
        Change::Added(text) => json!({ "kind": "added", "text": text }),
        Change::Removed(text) => json!({ "kind": "removed", "text": text }),
        Change::Elided(lines) => json!({ "kind": "elided", "lines": lines }),
    }
}

/// A call the turn made, as the person watching sees it.
///
/// `note: null` means the call has not finished. That is the only thing distinguishing a
/// running line from one that finished with nothing to say, so it is sent as an explicit
/// null rather than an absent key: a client reading an absent key as "finished, no note"
/// would draw every in-flight call as complete.
pub fn activity(activity: &Activity) -> Value {
    json!({
        "verb": activity.verb,
        "target": activity.target,
        "note": activity.note,
        "failed": activity.failed,
        "untrusted": activity.untrusted,
        "changes": activity.changes.iter().map(change).collect::<Vec<_>>(),
    })
}

/// Quarantined content, released for a screen and stopping there.
///
/// The preview is already trimmed by the kernel to twelve lines of at most a hundred and
/// sixty characters, and `lines` is the true total, so a client can say what it left out.
/// A preview that stops without saying so reads as the whole thing.
pub fn shown(shown: &Shown) -> Value {
    json!({
        "origin": shown.origin,
        "reach": reach(shown.reach),
        "label": shown.label,
        "preview": shown.preview,
        "lines": shown.lines,
    })
}

/// One task from the plan a turn is working to.
pub fn row(row: &Row) -> Value {
    json!({ "content": row.content, "status": status(row.status) })
}

/// One thing said, from a conversation nobody watched happen.
///
/// A `Tool` line says only that a call happened and what it was about. The record does
/// not store what came of it, so there is no note here and a client must not draw one:
/// live turns get `tool.finished` with an outcome, replayed ones do not, and inventing
/// one would be worse than the gap.
pub fn said(said: &Said) -> Value {
    match said {
        Said::User(text) => json!({ "kind": "user", "text": text }),
        Said::Assistant(text) => json!({ "kind": "assistant", "text": text }),
        Said::Tool(text) => json!({ "kind": "tool", "text": text }),
    }
}

/// A write awaiting a person's decision.
///
/// The complete body is **not** sent, only the diff. A reviewer reads a few lines rather
/// than spotting a difference in a whole file, and putting `contents` on the wire invites
/// a front-end to show that instead. `existing` says whether anything would be lost
/// without shipping what it was.
///
/// `untrusted` means the body came from somewhere nobody vouched for. Reviewing that is a
/// different act from reviewing the model's own work, and a front-end must not make the
/// two look alike.
pub fn write_request(id: u64, request: &WriteRequest) -> Value {
    let diff = request.diff();
    json!({
        "request": id,
        "path": request.path,
        "intent": intent(request.intent),
        "untrusted": request.untrusted,
        "existing": request.existing.is_some(),
        "added": diff.added(),
        "removed": diff.removed(),
        // False when the diff had to give up on an exact answer, which happens on two
        // large and wholly dissimilar files: the table it needs is quadratic and is
        // bounded rather than allowed to allocate without limit. A reviewer is entitled
        // to know they are reading an approximation of the change.
        "exact": diff.is_exact(),
        "changes": diff.condensed(CONTEXT_LINES).iter().map(change).collect::<Vec<_>>(),
    })
}
