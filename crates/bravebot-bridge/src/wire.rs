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
use bravebot_agent::confirm::{
    Decision, Intent, OutputRequest, RunDecision, RunRequest, VouchRequest, WriteRequest,
};
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

/// Read an answer to a run, which is two answers rather than one.
///
/// `remember` is only ever read from an approval. A refusal that remembered would be a
/// standing "never ask me again" nobody asked for, and the kernel has no such state to
/// put it in — but the more important reason is that a client sending
/// `{"decision": "reject", "remember": true}` has said something incoherent, and the
/// reading that costs least is the one that forgets.
///
/// Anything other than a literal `true` is a no, on the same grounds as [`decision`]:
/// remembering is nearly as consequential as approving, since it answers every later
/// question about the same command.
pub fn run_decision(decision_value: &Value, remember_value: &Value) -> RunDecision {
    match decision(decision_value) {
        Decision::Approve if remember_value.as_bool() == Some(true) => {
            RunDecision::approve_always()
        }
        Decision::Approve => RunDecision::approve(),
        Decision::Reject => RunDecision::reject(),
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

/// A pipeline awaiting a person's decision.
///
/// Every stage carries the name the model wrote **and** what it resolved to, because they
/// are not the same claim: `$PATH` decides what `grep` means, and somebody vouching for a
/// program should be looking at the binary they are vouching for. A front-end that shows
/// only one of the two is showing the wrong one.
///
/// `display` is the agent's own rendering of the argv, so both front-ends put the same
/// characters in front of a reviewer — argument boundaries included, which is where a
/// space in a filename stops being cosmetic.
///
/// `releasesPrivate` is a second and independent reason to be careful, on confidentiality
/// rather than integrity: bytes going into a program are released somewhere this policy
/// stops governing. It is sent separately from the stages because it is not a property of
/// any one of them.
pub fn run_request(id: u64, request: &RunRequest) -> Value {
    let stages: Vec<Value> = request
        .pipeline
        .stages
        .iter()
        .enumerate()
        .map(|(index, stage)| {
            json!({
                "program": stage.program,
                // Positional: `resolved` is in stage order. A stage with nothing opposite
                // it sends null rather than a guess, which a front-end must draw as
                // "unresolved" rather than as the name repeated.
                "resolved": request.resolved.get(index),
                "args": stage.args,
                "display": stage.display(),
            })
        })
        .collect();

    json!({
        "request": id,
        "stages": stages,
        "directory": request.directory,
        "releasesPrivate": request.releases_private(),
        // What approving-and-remembering would cover, which is the thing the second
        // answer needs to be about. A pipeline vouches for all of its stages: one that
        // still had to ask about a stage would not have stopped asking.
        "vouches": request
            .would_vouch_for()
            .iter()
            .map(|command| json!({ "program": command.program, "args": command.args, "display": command.display() }))
            .collect::<Vec<_>>(),
        "summary": request.summary(),
    })
}

/// A command's output the planner has asked to read.
///
/// The bytes are here in full, and that is the point rather than an oversight: a person
/// deciding whether the model may read something must be reading it themselves, so a
/// front-end that truncates this is asking them to approve what they cannot see. Unlike
/// every other question in this file the answer rests on the content, which is why
/// [`crate::turn::BridgeConfirmer::confirm_read_output`] cannot fall back to anything
/// except no.
///
/// It is released for a screen and stops there. Nothing here may be fed back to the model
/// by the front-end; approving is how it reaches the planner, and that path runs through
/// the kernel.
pub fn output_request(id: u64, request: &OutputRequest) -> Value {
    json!({
        "request": id,
        "command": request.command,
        "reference": request.reference,
        "lines": request.lines(),
        "output": request.output,
        "summary": request.summary(),
    })
}

/// A quarantined file the model would like to read.
///
/// `truncated` is load-bearing: a preview that stops without saying so reads as the whole
/// file, and a person vouching for a path on the strength of its first few lines should
/// know that is what they are doing.
pub fn vouch_request(id: u64, request: &VouchRequest) -> Value {
    json!({
        "request": id,
        "path": request.path,
        "preview": request.preview,
        "truncated": request.truncated,
    })
}
