//! The library's surface: what a front-end can ask for, and what it gets told.
//!
//! One method per protocol request, plus a callback events leave through. Nothing here
//! writes to stdout, reads stdin, or ends the process; a transport does that, and there
//! can be more than one.
//!
//! # Handles
//!
//! A session's id is unique only within its project directory, so calls do not carry
//! `(directory, id)` pairs. Opening one mints a short handle that stands for the pair for
//! as long as this process lives. Handles are not written down and a front-end must not
//! store one: `session.list` returns the durable `(directory, id)`, and opening converts
//! that into a handle again.

use crate::emit::{Emitter, Listener};
use crate::protocol::{ErrorCode, Event, Failure, Request};
use crate::running::{Running, State};
use crate::turn::{BridgeConfirmer, BridgeReporter, BridgeSink, Reply};
use crate::{store, wire};
use bravebot_agent::Workspace;
use bravebot_agent::turn::{self as agent_turn, Task, TurnError};
use bravebot_config::Config;
use bravebot_core::cancel::Cancel;
use bravebot_core::trust::TrustStore;
use bravebot_net::Egress;
use bravebot_tui::sessions::{Handle, Record, Standing};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;

/// A session this process has open.
struct Open {
    project: PathBuf,
    /// What the session carries between turns. Behind a mutex because a worker takes it
    /// for the length of a turn.
    state: Arc<Mutex<State>>,
    /// Whether the user has answered the trust question for this session.
    ///
    /// `None` means unanswered, and a turn is refused until it is. Not a bool with a
    /// default: defaulting either way answers on behalf of somebody who was never asked,
    /// which is the mistake the whole trust design exists to avoid.
    answered_trust: bool,
    /// The turn in flight, if there is one.
    running: Option<Running>,
}

/// Drives the agent for a front-end.
pub struct Bridge {
    open: HashMap<String, Open>,
    next_handle: u64,
    emitter: Emitter,
}

impl Bridge {
    pub fn new(emit: Listener) -> Self {
        Self {
            open: HashMap::new(),
            next_handle: 0,
            emitter: Emitter::new(emit),
        }
    }

    /// Announce what this is, before anything is asked.
    pub fn ready(&mut self) {
        let info = self.info();
        self.emitter.send(Event::global("agent.ready", info));
    }

    /// Route one request.
    ///
    /// The match is exhaustive over the methods this version knows; an unknown one is a
    /// `bad_request` rather than a panic, since a newer front-end against an older bridge
    /// is a situation that will happen and should degrade rather than crash.
    pub fn dispatch(&mut self, request: &Request) -> Result<Value, Failure> {
        match request.method.as_str() {
            "agent.info" => Ok(self.info()),
            "session.list" => self.list(request),
            "session.open" => self.open_session(request),
            "session.new" => self.new_session(request),
            "session.close" => self.close_session(request),
            "turn.send" => self.send_turn(request),
            "turn.cancel" => self.cancel_turn(request),
            "confirm.reply" => self.reply_confirm(request),
            "run.reply" => self.reply_run(request),
            "output.reply" => self.reply_output(request),
            "vouch.reply" => self.reply_vouch(request),
            "ask.reply" => self.reply_ask(request),
            "trust.reply" => self.reply_trust(request),
            "doctor" => Ok(Self::doctor()),
            other => Err(Failure::bad_request(format!("unknown method `{other}`"))),
        }
    }

    /// Which build of the agent is behind this.
    ///
    /// Worth surfacing in the interface: a transcript is read after the fact, usually
    /// because something in it went wrong, and the first question is which code produced
    /// it.
    fn info(&self) -> Value {
        json!({
            "build": crate::agent_build(),
            "version": env!("CARGO_PKG_VERSION"),
            "home": bravebot_tui::store::directory().map(|d| d.display().to_string()),
        })
    }

    // ------------------------------------------------------------ sessions

    fn list(&mut self, request: &Request) -> Result<Value, Failure> {
        let listed = match request.optional_string("directory") {
            Some(directory) => store::list_project(&PathBuf::from(directory)),
            None => store::list_all(),
        };

        let sessions: Vec<Value> = listed
            .iter()
            .map(|entry| {
                json!({
                    "id": entry.summary.id,
                    "directory": entry.project.display().to_string(),
                    "project": entry.project_name(),
                    "branch": entry.summary.branch,
                    "title": entry.summary.title,
                    "updated": entry.summary.updated,
                    "bytes": entry.summary.bytes,
                })
            })
            .collect();

        Ok(json!({ "sessions": sessions }))
    }

    fn open_session(&mut self, request: &Request) -> Result<Value, Failure> {
        let directory = PathBuf::from(request.string("directory")?);
        let id = request.string("id")?;

        let record = store::load(&directory, &id).ok_or_else(|| {
            Failure::new(
                ErrorCode::NoSuchSession,
                format!("no session `{id}` in {}", directory.display()),
            )
        })?;

        // A record that recorded a trust map was answered for by the person now resuming
        // it, and inherits it. One that did not is asked again: nothing recorded is not
        // the same as nothing trusted, and reading an absent map as an empty one would
        // answer on behalf of somebody who was never asked.
        let inherited = record.trust_map();
        let answered_trust = inherited.is_some();
        let state = State::resumed(&directory, &record, inherited.unwrap_or_default());

        let handle = self.mint(Open {
            project: directory.clone(),
            state: Arc::new(Mutex::new(state)),
            answered_trust,
            running: None,
        });

        if !answered_trust {
            self.emitter.send(Event::new(
                "trust.request",
                &handle,
                json!({ "directory": directory.display().to_string() }),
            ));
        }

        Ok(self.recount(&handle, &directory, &record))
    }

    /// Everything a front-end needs to draw a session it did not watch happen.
    fn recount(&self, handle: &str, directory: &std::path::Path, record: &Record) -> Value {
        // Restored rather than read straight off the record, because restoring is what
        // adds the note saying the quarantine's references no longer name anything — and
        // `recounted` filters that note back out. Going around it would show a transcript
        // subtly unlike the one a resume produces.
        let conversation = bravebot_agent::Conversation::restored(record.conversation.clone());
        let said: Vec<Value> = conversation.recounted().iter().map(wire::said).collect();

        let todos: HashMap<String, Vec<Value>> = record
            .todo_rows()
            .iter()
            .map(|(turn, rows)| (turn.to_string(), rows.iter().map(wire::row).collect()))
            .collect();

        json!({
            "session": handle,
            "record": {
                "id": record.id,
                "directory": record.directory,
                "branch": record.branch,
                "title": record.title,
                "started": record.started,
                "updated": record.updated,
                "turns": record.turns,
                "tokens": record.tokens,
                "build": record.build,
            },
            "said": said,
            "context": record.conversation.context,
            "todos": todos,
            "trust": {
                "known": record.trust.is_some(),
                "rules": record.trust.as_ref().map(|rules| {
                    rules.iter().map(|rule| json!({
                        "path": rule.path,
                        "integrity": rule.integrity,
                    })).collect::<Vec<_>>()
                }),
            },
            "branchNote": bravebot_tui::sessions::branch_note(
                record.branch.as_deref(),
                bravebot_tui::sessions::branch_of(directory).as_deref(),
            ),
            "buildNote": bravebot_tui::sessions::build_note(
                record.build.as_deref(),
                crate::agent_build(),
            ),
        })
    }

    fn new_session(&mut self, request: &Request) -> Result<Value, Failure> {
        let directory = PathBuf::from(request.string("directory")?);

        if !directory.is_dir() {
            return Err(Failure::new(
                ErrorCode::NotADirectory,
                format!("{} is not a directory", directory.display()),
            ));
        }
        if bravebot_tui::store::directory().is_none() {
            return Err(Failure::new(ErrorCode::NoHome, "no home directory to store sessions in"));
        }

        let branch = bravebot_tui::sessions::branch_of(&directory);
        let handle = self.mint(Open {
            project: directory.clone(),
            // An empty map until the user answers. Nothing runs before then, so this is
            // never the map a turn uses.
            state: Arc::new(Mutex::new(State::fresh(TrustStore::new()))),
            answered_trust: false,
            running: None,
        });

        // Nothing is written until the first turn. An opened-and-abandoned window should
        // leave no trace, which is also how `bravebot` behaves.
        self.emitter.send(Event::new(
            "trust.request",
            &handle,
            json!({ "directory": directory.display().to_string() }),
        ));

        Ok(json!({
            "session": handle,
            "directory": directory.display().to_string(),
            "branch": branch,
        }))
    }

    fn close_session(&mut self, request: &Request) -> Result<Value, Failure> {
        let handle = request.string("session")?;
        let open = self.open.remove(&handle).ok_or_else(Failure::no_such_session)?;

        // Stop the work, then refuse whatever it was waiting on. Both, and in that order:
        // cancelling alone would leave a write blocked on an answer that is never coming,
        // and refusing alone would let the turn carry on past it.
        if let Some(running) = &open.running {
            running.cancel.cancel();
            running.refuse_pending();
        }
        Ok(json!({}))
    }


    // ------------------------------------------------------------ turns

    /// Start a turn, and return before it finishes.
    ///
    /// Everything the turn produces arrives as events. The response says only that it
    /// began, because a turn takes as long as a model does and a front-end that blocked
    /// on it would show nothing until it ended.
    fn send_turn(&mut self, request: &Request) -> Result<Value, Failure> {
        let handle = request.string("session")?;
        let prompt = request.string("prompt")?;
        let files: Vec<String> = request
            .params
            .get("files")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();

        self.reap(&handle);

        let open = self.open.get(&handle).ok_or_else(Failure::no_such_session)?;

        if !open.answered_trust {
            return Err(Failure::bad_request(
                "this session has not been asked whether the directory is trusted; \
                 send trust.reply first",
            ));
        }
        if open.running.is_some() {
            return Err(Failure::new(
                ErrorCode::TurnInFlight,
                "a turn is already running in this session",
            ));
        }

        let config = Config::from_env()
            .map_err(|error| Failure::new(ErrorCode::Config, error.to_string()))?;
        let workspace = Workspace::new(open.project.clone())
            .map_err(|error| Failure::new(ErrorCode::Internal, error.to_string()))?;

        let project = open.project.clone();
        let state = Arc::clone(&open.state);
        let turn_number = state.lock().map(|s| s.turns + 1).unwrap_or(1);

        // A fresh token and a fresh channel per turn. Reusing either could cancel a turn
        // before it started, or deliver yesterday's answer to today's question.
        let cancel = Cancel::new();
        let (answers_tx, answers_rx) = mpsc::channel();
        let pending: crate::turn::Pending = Arc::new(Mutex::new(None));

        let finished = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let running = Running {
            cancel: cancel.clone(),
            answers: answers_tx,
            pending: Arc::clone(&pending),
            turn: turn_number,
            finished: Arc::clone(&finished),
        };

        let emitter = self.emitter.clone();
        let session = handle.clone();

        thread::spawn(move || {
            work(Work {
                emitter,
                session,
                project,
                state,
                config,
                workspace,
                prompt,
                files,
                turn: turn_number,
                cancel,
                pending,
                answers: answers_rx,
                finished,
            });
        });

        self.emitter.send(Event::new(
            "turn.started",
            &handle,
            json!({ "turn": turn_number }),
        ));

        if let Some(open) = self.open.get_mut(&handle) {
            open.running = Some(running);
        }

        Ok(json!({ "turn": turn_number }))
    }

    /// Ask the turn to stop.
    ///
    /// Returns at once; the turn ends when the engine next looks at the token. A pending
    /// write is deliberately **not** answered by this: cancelling and approving are
    /// different decisions, and conflating them would let a cancel authorise a write.
    fn cancel_turn(&mut self, request: &Request) -> Result<Value, Failure> {
        let handle = request.string("session")?;
        let open = self.open.get(&handle).ok_or_else(Failure::no_such_session)?;
        if let Some(running) = &open.running {
            running.cancel.cancel();
        }
        // Cancelling when nothing is running is not an error: the turn may have finished
        // between the user pressing the key and this arriving.
        Ok(json!({}))
    }

    /// Carry an answer back to the write that is waiting for it.
    fn reply_confirm(&mut self, request: &Request) -> Result<Value, Failure> {
        let reply = Reply::Write(wire::decision(request.param("decision")));
        self.deliver(request, reply)
    }

    /// Answer a run, which is the one question with two answers.
    fn reply_run(&mut self, request: &Request) -> Result<Value, Failure> {
        let reply = Reply::Run(wire::run_decision(
            request.param("decision"),
            request.param("remember"),
        ));
        self.deliver(request, reply)
    }

    /// Answer whether the planner may read a command's output.
    fn reply_output(&mut self, request: &Request) -> Result<Value, Failure> {
        let reply = Reply::Output(wire::decision(request.param("decision")));
        self.deliver(request, reply)
    }

    /// Answer whether to vouch for a quarantined path.
    fn reply_vouch(&mut self, request: &Request) -> Result<Value, Failure> {
        let reply = Reply::Vouch(wire::decision(request.param("decision")));
        self.deliver(request, reply)
    }

    /// Answer a series of questions, one answer per question.
    fn reply_ask(&mut self, request: &Request) -> Result<Value, Failure> {
        let reply = Reply::Ask(wire::answers(request.param("answers")));
        self.deliver(request, reply)
    }

    /// Carry one answer to the turn that is waiting for it.
    ///
    /// Shared by all four, because everything after "which question is this" is identical
    /// and the differences are all in the reading of the answer, above. Note what is *not*
    /// here: no check that the front-end sent the kind of reply matching what is
    /// outstanding. That is [`Running::answer`]'s job, and it is left there so there is one
    /// place where an id and a kind are compared against the question that was asked.
    fn deliver(&mut self, request: &Request, reply: Reply) -> Result<Value, Failure> {
        let handle = request.string("session")?;
        let id = request.number("request")?;

        let open = self.open.get(&handle).ok_or_else(Failure::no_such_session)?;
        let Some(running) = &open.running else {
            return Err(Failure::new(
                ErrorCode::NoSuchRequest,
                "no turn is running in this session",
            ));
        };

        if running.answer(id, reply) {
            Ok(json!({}))
        } else {
            // Unknown, or already used. An approval is single-use and bound to the one
            // write it was shown for, so this changes nothing rather than being retried.
            Err(Failure::new(
                ErrorCode::NoSuchRequest,
                format!("request {id} is not waiting for an answer"),
            ))
        }
    }

    /// Record what the user answered about trusting the directory.
    fn reply_trust(&mut self, request: &Request) -> Result<Value, Failure> {
        let handle = request.string("session")?;
        let trusted = request
            .params
            .get("trusted")
            .and_then(Value::as_bool)
            .ok_or_else(|| Failure::bad_request("`trusted` must be a boolean"))?;

        let open = self.open.get_mut(&handle).ok_or_else(Failure::no_such_session)?;

        // Trusting records the workspace root, which covers everything beneath it.
        // Declining records nothing, leaving a map in which no path is trusted. The same
        // two outcomes the terminal offers, so an answer means the same in both.
        let mut trust = TrustStore::new();
        if trusted {
            trust.trust(".");
        }
        if let Ok(mut state) = open.state.lock() {
            state.trust = trust;
        }
        open.answered_trust = true;

        Ok(json!({ "trusted": trusted }))
    }

    /// Check the agent's configuration and confinement.
    ///
    /// Shelled out to, because these checks live in the CLI's own binary upstream and
    /// cannot be called as a library without a change we do not make. `found: false` when
    /// no `bravebot` is on PATH: a diagnostic that is unavailable should say so and leave the
    /// rest of the app working.
    fn doctor() -> Value {
        match std::process::Command::new("bravebot").arg("doctor").output() {
            Ok(output) => {
                let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
                text.push_str(&String::from_utf8_lossy(&output.stderr));
                json!({
                    "found": true,
                    "structured": false,
                    "text": text,
                    "exitCode": output.status.code(),
                })
            }
            Err(error) => json!({
                "found": false,
                "structured": false,
                "text": format!("could not run `bravebot doctor`: {error}"),
                "exitCode": null,
            }),
        }
    }

    /// Forget a turn that has already finished.
    ///
    /// The worker owns the end of a turn and does not report back, so the dispatch thread
    /// notices lazily, from a flag the worker sets on its way out. It must not notice by
    /// probing the answer channel: anything sent down that to test whether it is still
    /// connected is a real decision arriving at a real write.
    fn reap(&mut self, handle: &str) {
        if let Some(open) = self.open.get_mut(handle)
            && open.running.as_ref().is_some_and(Running::is_finished)
        {
            open.running = None;
        }
    }

    // ------------------------------------------------------------ plumbing

    fn mint(&mut self, session: Open) -> String {
        self.next_handle += 1;
        let handle = format!("s{}", self.next_handle);
        self.open.insert(handle.clone(), session);
        handle
    }
}

/// Everything a worker needs to run one turn.
///
/// A struct rather than a dozen arguments, because the list was the kind that grows one
/// parameter at a time until nobody can read the call.
struct Work {
    emitter: Emitter,
    session: String,
    project: PathBuf,
    state: Arc<Mutex<State>>,
    config: Config,
    workspace: Workspace,
    prompt: String,
    files: Vec<String>,
    turn: usize,
    cancel: Cancel,
    pending: crate::turn::Pending,
    answers: mpsc::Receiver<crate::turn::Reply>,
    finished: Arc<std::sync::atomic::AtomicBool>,
}

/// Run one turn to its end, whatever that end is.
///
/// The worker owns the whole of it: the call, writing the record afterwards, and saying
/// what happened. A turn that fails is still part of the conversation and is still
/// written down — the next question is usually about it.
fn work(work: Work) {
    let Work {
        emitter,
        session,
        project,
        state,
        config,
        workspace,
        prompt,
        files,
        turn,
        cancel,
        pending,
        answers,
        finished,
    } = work;

    // Held for the length of the turn. Nothing else contends for it: a session with a
    // turn in flight refuses another one.
    let Ok(mut state) = state.lock() else {
        finished.store(true, std::sync::atomic::Ordering::Release);
        return;
    };

    let mut task = Task::new(&prompt).with_home(bravebot_agent::home::directory());
    for file in &files {
        task = task.with_file(file);
    }

    let mut reporter = BridgeReporter::new(emitter.clone(), &session);
    let mut confirmer = BridgeConfirmer::new(emitter.clone(), &session, pending, answers);
    let mut sink = BridgeSink::new(emitter.clone(), &session, turn);
    let egress = Egress::new();

    // Cloned out before the call, because the conversation is borrowed mutably for the
    // duration and both of these are passed by value.
    let trust = state.trust.clone();
    let programs = state.programs.clone();
    let outcome = agent_turn::resume(
        &config,
        &egress,
        &workspace,
        &task,
        &mut state.conversation,
        &mut confirmer,
        &mut reporter,
        &mut sink,
        trust,
        programs,
        &cancel,
    );

    // The prompt joins the history the terminal also reads, so recall works across both
    // front-ends. Best-effort by design upstream, and nothing here depends on it.
    bravebot_tui::store::append_history(&prompt);

    state.turns = turn;
    if state.first_prompt.is_none() {
        state.first_prompt = Some(prompt.clone());
    }

    match outcome {
        Ok(outcome) => {
            // The map after the turn, which may differ from the one it started with: a
            // turn that writes untrusted data into a trusted path records that path as
            // untrusted, and the next turn must inherit that or it would read the data
            // back as trusted.
            state.trust = outcome.trust.clone();
            // Taken from the outcome rather than from whatever asked, so there is one copy
            // of the answer. Nothing is added while this front-end refuses every vouch, but
            // a set that came back smaller than it went in would be a lost permission.
            state.programs = outcome.programs.clone();
            state.tokens += outcome.tokens;

            save(&project, &mut state, turn, sink.trail());

            let rules: Vec<Value> = state
                .trust
                .rules()
                .map(|(path, integrity)| {
                    // The same two words the record is written with, so a rule reads the
                    // same whether it came off disk or out of a finished turn.
                    let integrity = match integrity {
                        bravebot_core::label::Integrity::Trusted => "trusted",
                        bravebot_core::label::Integrity::Untrusted => "untrusted",
                    };
                    json!({ "path": path, "integrity": integrity })
                })
                .collect();

            emitter.send(Event::new(
                "turn.done",
                &session,
                json!({
                    "turn": turn,
                    // The released reply, authorised inside the turn while the policy was
                    // still open. Never `outcome.reply`, which is the labelled value.
                    "reply": outcome.reply_for_display(),
                    "model": outcome.model,
                    "steps": outcome.steps,
                    "clean": outcome.clean,
                    "tokens": outcome.tokens,
                    "outputTokens": outcome.output_tokens,
                    "notices": outcome.notices,
                    "trust": { "rules": rules },
                }),
            ));
        }
        Err(error) => {
            save(&project, &mut state, turn, sink.trail());

            let kind = match &error {
                TurnError::Cancelled => "cancelled",
                TurnError::Precommit(_) => "precommit",
                TurnError::Workspace(_) => "workspace",
                TurnError::Chat(_) => "chat",
            };
            emitter.send(Event::new(
                "turn.error",
                &session,
                json!({ "turn": turn, "kind": kind, "message": error.to_string() }),
            ));
        }
    }

    // Last, and after the record is on disk, so a front-end that reloads on being told
    // the turn ended reads the same thing this wrote.
    finished.store(true, std::sync::atomic::Ordering::Release);
}

/// Write the session down, in the agent's own format.
///
/// The same `Handle` the terminal uses, so a session written here is one `bravebot --resume`
/// can pick up. Created on the first turn rather than when the window opened: an
/// abandoned window should leave nothing behind.
fn save(project: &std::path::Path, state: &mut State, turn: usize, trail: &bravebot_tui::audit::Trail) {
    let handle = state
        .handle
        .get_or_insert_with(|| Handle::begin(project));

    let first = state.first_prompt.clone().unwrap_or_default();
    handle.save(
        &first,
        Standing {
            conversation: &state.conversation.snapshot(),
            turns: state.turns,
            tokens: state.tokens,
            todos: &state.todos,
            trust: &state.trust,
            programs: &state.programs,
        },
    );
    handle.append_audit(turn, trail.events());
}
