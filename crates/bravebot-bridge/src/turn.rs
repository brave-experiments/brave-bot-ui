//! Running a turn, and telling a front-end what it is doing.
//!
//! Three implementations of the seams the turn engine takes its interface as. Two of them
//! only talk, and one of them asks — and the asymmetry between those decides how each
//! behaves when something goes wrong.
//!
//! [`BridgeReporter`] and [`BridgeSink`] **announce**. There is no reply to wait for and
//! nothing to refuse, so every failure is a dropped line.
//!
//! [`BridgeConfirmer`] **asks**, and blocks until it is answered. Every failure resolves
//! to refusal: a channel that cannot carry the question cannot carry consent either. That
//! is the single most important property in this file, and the tests in `tests/refusal.rs`
//! exist to keep it true.

use crate::emit::Emitter;
use crate::protocol::Event;
use crate::wire;
use bravebot_agent::confirm::{
    Confirmer, Decision, OutputRequest, RunDecision, RunRequest, VouchRequest, WriteRequest,
};
use bravebot_core::ask::{Answer, Asking};
use bravebot_agent::report::{Activity, Landing, Phase, Reporter, Shown};
use bravebot_core::event::Sink;
use bravebot_core::todo::Row;
use serde_json::json;
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex};

/// Which write, if any, is waiting on a person right now.
///
/// Shared between the worker that asked and the dispatch thread that will be told the
/// answer. `None` means nothing is outstanding, so a reply that names a request cannot be
/// applied — which is what makes an approval single-use rather than replayable.
pub type Pending = Arc<Mutex<Option<u64>>>;

// ---------------------------------------------------------------- announcing

/// Tells a front-end what a turn is doing.
pub struct BridgeReporter {
    emitter: Emitter,
    session: String,
    /// The last token count actually sent. See [`Reporter::output_tokens`].
    last_tokens: Option<u64>,
}

impl BridgeReporter {
    pub fn new(emitter: Emitter, session: impl Into<String>) -> Self {
        Self {
            emitter,
            session: session.into(),
            last_tokens: None,
        }
    }

    fn say(&self, name: &'static str, data: serde_json::Value) {
        self.emitter.send(Event::new(name, &self.session, data));
    }
}

impl Reporter for BridgeReporter {
    fn todos(&mut self, rows: Vec<Row>) {
        let rows: Vec<_> = rows.iter().map(wire::row).collect();
        self.say("todos", json!({ "rows": rows }));
    }

    /// How much the model has written, when it changes and not before.
    ///
    /// The engine reports this on a timer rather than on a change, so a slow round
    /// repeats one figure many times. A terminal redrawing a counter does not care; a
    /// front-end across a pipe is woken for every one of them. In the first live turn
    /// this was 130 of 168 events, and 63 of those said nothing new.
    ///
    /// Coalescing loses nothing: the figure is cumulative, so the newest supersedes every
    /// earlier one, and a front-end that never saw the repeats shows the same number.
    fn output_tokens(&mut self, written: u64) {
        if self.last_tokens == Some(written) {
            return;
        }
        self.last_tokens = Some(written);
        self.say("tokens", json!({ "written": written }));
    }

    fn phase(&mut self, phase: Phase) {
        self.say("phase", json!({ "phase": wire::phase(phase) }));
    }

    /// What the model said between tool calls.
    ///
    /// Empty where it went straight from one call to the next, which the engine still
    /// reports. There is nothing to draw for it, and an interface that made a bubble per
    /// empty narration would show a row of blank messages.
    fn narration(&mut self, text: String) {
        if text.trim().is_empty() {
            return;
        }
        self.say("narration", json!({ "text": text }));
    }

    fn quarantined(&mut self, shown: Shown) {
        self.say("quarantined", wire::shown(&shown));
    }

    fn landed(&mut self, landing: Landing) {
        self.say("landed", json!({ "landing": wire::landing(landing) }));
    }

    fn tool_started(&mut self, activity: Activity) {
        self.say("tool.started", wire::activity(&activity));
    }

    fn tool_finished(&mut self, activity: Activity) {
        self.say("tool.finished", wire::activity(&activity));
    }
}

/// Collects the audit trail, and streams it as it arrives.
///
/// Both, deliberately. The collected copy is what gets written beside the record at the
/// end of the turn, in the agent's own format, so `bravebot --resume` reads a complete trail.
/// The stream is for the interface, which should not have to wait for a turn to end
/// before it can show what the gates decided.
///
/// The two can disagree if a turn dies before its trail is written. The interface reloads
/// on `turn.done` for that reason; until then what it holds is provisional.
pub struct BridgeSink {
    emitter: Emitter,
    session: String,
    turn: usize,
    trail: bravebot_tui::audit::Trail,
}

impl BridgeSink {
    pub fn new(emitter: Emitter, session: impl Into<String>, turn: usize) -> Self {
        Self {
            emitter,
            session: session.into(),
            turn,
            trail: bravebot_tui::audit::Trail::new(),
        }
    }

    /// The trail as the agent writes it down.
    pub fn trail(&self) -> &bravebot_tui::audit::Trail {
        &self.trail
    }
}

impl Sink for BridgeSink {
    fn emit(&mut self, event: bravebot_core::event::Event) {
        // Projected with the agent's own function rather than a second spelling of it:
        // two renderings of one trail would drift the moment either changed.
        let data = json!({
            "turn": self.turn,
            "event": bravebot_tui::audit::as_json(&event),
        });
        self.emitter.send(Event::new("audit", &self.session, data));
        self.trail.emit(event);
    }
}

// ---------------------------------------------------------------- asking

/// Carries a write to whoever is watching, and waits.
///
/// Everything about this type is arranged so that the answer is either an explicit
/// approval from a person or a refusal. There is no third outcome and no timeout: a write
/// waits for a human for as long as that takes, which is what it should do.
pub struct BridgeConfirmer {
    emitter: Emitter,
    session: String,
    pending: Pending,
    answers: Receiver<Decision>,
    next: u64,
}

impl BridgeConfirmer {
    pub fn new(
        emitter: Emitter,
        session: impl Into<String>,
        pending: Pending,
        answers: Receiver<Decision>,
    ) -> Self {
        Self {
            emitter,
            session: session.into(),
            pending,
            answers,
            next: 0,
        }
    }

    /// Say that something was refused for want of anywhere to ask.
    ///
    /// A silent refusal is the worst of the options here: the turn stops doing something
    /// and the transcript gives no reason, so the model looks broken rather than governed.
    /// Announced rather than asked — the answer is already decided by the time this is
    /// called, and this only explains it.
    ///
    /// The summaries come from the request types, which name the command and how much
    /// output there was without quoting any of it. Nothing a program printed reaches here.
    fn refused(&self, what: &str) {
        let text = format!(
            "Refused: nothing in this window can ask whether to {what}. \
             Use the terminal client for this turn."
        );
        self.emitter.send(Event::new(
            "narration",
            &self.session,
            json!({ "text": text }),
        ));
    }
}

impl Confirmer for BridgeConfirmer {
    fn confirm_write(&mut self, request: &WriteRequest) -> Decision {
        self.next += 1;
        let id = self.next;

        // Registered before the question goes out, so an answer that arrives immediately
        // has something to match against. The other order has a race the front-end wins.
        let Ok(mut pending) = self.pending.lock() else {
            // Another thread panicked while holding this. Nothing can be registered, so
            // nothing can be answered, so nothing is approved.
            return Decision::Reject;
        };
        *pending = Some(id);
        drop(pending);

        self.emitter.send(Event::new(
            "confirm.request",
            &self.session,
            wire::write_request(id, request),
        ));

        // Blocks until the dispatch thread sends an answer, or until the sending end is
        // dropped — which is what a departed front-end, a closed session, or a shutting
        // down process looks like from here. All of them are refusals.
        let decision = self.answers.recv().unwrap_or(Decision::Reject);

        // Consumed either way. An id that is no longer pending cannot be answered again,
        // so an approval cannot be replayed against a second write.
        if let Ok(mut pending) = self.pending.lock() {
            *pending = None;
        }

        decision
    }

    /// Refuses, because the protocol has no way to ask this yet.
    ///
    /// A refusal that does not remember, which the trait asks for explicitly and is the
    /// more important half: a single unasked "no" costs one command, where a remembered
    /// one would quietly vouch for a program on the strength of a question nobody saw.
    fn confirm_run(&mut self, request: &RunRequest) -> RunDecision {
        self.refused(&request.summary());
        RunDecision::reject()
    }

    /// Refuses, because the protocol has no way to show the output this asks about.
    ///
    /// The one question in the trait whose answer rests on bytes rather than on a
    /// prediction, so an implementation that cannot show them has only one honest answer.
    fn confirm_read_output(&mut self, request: &OutputRequest) -> Decision {
        self.refused(&request.summary());
        Decision::Reject
    }

    /// Refuses, because the protocol has no way to ask this yet.
    ///
    /// A yes here writes a standing rule into the trust map, so an unasked one would
    /// outlive the turn that invented it.
    fn confirm_vouch(&mut self, request: &VouchRequest) -> Decision {
        self.refused(&format!("vouch for {}", request.path));
        Decision::Reject
    }

    /// Answers nothing, because this protocol has no way to put a question to the person.
    ///
    /// The empty vector is the contract's own way of saying "nobody could be asked" — the
    /// kernel reads a missing answer as a decline, and saying nothing is the one reply that
    /// cannot be wrong about how many questions there were. Returning a decline per question
    /// would be the same outcome dressed up as a person's choice, which is exactly the
    /// mistake `confirm_write` is arranged to avoid. When the protocol grows an `ask`
    /// request/response pair, this becomes the same blocking round trip as the one above.
    fn ask_user(&mut self, _asking: &Asking) -> Vec<Answer> {
        Vec::new()
    }
}
