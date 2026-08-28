//! That a session written here is a session the terminal can read.
//!
//! The whole justification for depending on the agent's own `sessions` module rather than
//! inventing a store is that both front-ends write one format. That is a claim, and a
//! claim about two programs agreeing is worth a test rather than a sentence.
//!
//! No model is involved: this writes a record the way a finished turn does and reads it
//! back the way `bravebot --resume` does.

use bravebot_aichat::protocol::Message;
use bravebot_core::todo::{Row, Status};
use bravebot_core::programs::TrustedPrograms;
use bravebot_core::trust::TrustStore;
use bravebot_tui::sessions::{self, Handle, Standing};
use std::collections::BTreeMap;

/// A directory nothing else is using, inside the real session store.
///
/// Sessions are keyed by the working directory they ran in, so an unused temporary path
/// gets its own directory under `~/.bravebot/sessions` and cannot disturb a real one.
fn scratch(name: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("bravebot-bridge-interop-{name}"));
    std::fs::create_dir_all(&path).expect("a scratch directory");
    path
}

fn clean_up(project: &std::path::Path) {
    if let Some(directory) = sessions::project_directory(project) {
        let _ = std::fs::remove_dir_all(directory);
    }
}

#[test]
fn a_record_written_here_is_read_back_by_the_agents_own_reader() {
    let project = scratch("round-trip");
    clean_up(&project);

    let mut conversation = bravebot_agent::Conversation::new();
    conversation.push(Message::user("what does this do?"));
    conversation.push(Message::assistant("it parses commas"));

    let mut trust = TrustStore::new();
    trust.trust(".");

    let mut todos = BTreeMap::new();
    todos.insert(
        1,
        vec![Row { content: "read the parser".into(), marker: "[x]", status: Status::Done }],
    );

    let mut handle = Handle::begin(&project);
    handle.save(
        "what does this do?",
        Standing {
            conversation: &conversation.snapshot(),
            turns: 1,
            tokens: 42,
            todos: &todos,
            trust: &trust,
            programs: &TrustedPrograms::new(),
        },
    );
    let id = handle.id().to_string();

    // Read back exactly as the terminal's resume does.
    let listed = sessions::list(&project);
    assert_eq!(listed.len(), 1, "the session should be listed");
    assert_eq!(listed[0].id, id);
    assert_eq!(listed[0].title, "what does this do?");

    let record = sessions::load(&project, &id).expect("the record should load");
    assert_eq!(record.turns, 1);
    assert_eq!(record.tokens, 42);
    assert_eq!(record.directory, project.display().to_string());
    assert!(record.trust.is_some(), "the map must survive, not be re-derived");
    assert_eq!(record.todo_rows()[&1][0].content, "read the parser");

    // And as the bridge's own cross-project discovery does, which is the part that is
    // ours rather than upstream's.
    let found = bravebot_bridge::store::list_all();
    assert!(
        found.iter().any(|entry| entry.summary.id == id && entry.project == project),
        "a session in a new project must be discovered without being told where to look"
    );

    clean_up(&project);
}

/// The bridge recounts a stored conversation the same way the terminal does.
#[test]
fn a_stored_conversation_recounts_to_what_a_person_said() {
    let project = scratch("recount");
    clean_up(&project);

    let mut conversation = bravebot_agent::Conversation::new();
    conversation.push(Message::user("first question"));
    conversation.push(Message::assistant("first answer"));
    conversation.push(Message::user("second question"));
    conversation.push(Message::assistant("second answer"));

    let mut handle = Handle::begin(&project);
    handle.save(
        "first question",
        Standing {
            conversation: &conversation.snapshot(),
            turns: 2,
            tokens: 0,
            todos: &BTreeMap::new(),
            trust: &TrustStore::new(),
            programs: &TrustedPrograms::new(),
        },
    );
    let id = handle.id().to_string();

    let record = sessions::load(&project, &id).expect("loads");
    let restored = bravebot_agent::Conversation::restored(record.conversation.clone());
    let said = restored.recounted();

    let text: Vec<&str> = said
        .iter()
        .map(|entry| match entry {
            bravebot_agent::conversation::Said::User(t) => t.as_str(),
            bravebot_agent::conversation::Said::Assistant(t) => t.as_str(),
            bravebot_agent::conversation::Said::Tool(t) => t.as_str(),
        })
        .collect();

    assert!(text.contains(&"first question"));
    assert!(text.contains(&"second answer"));

    clean_up(&project);
}

/// Resuming a session and taking a turn continues that session, rather than forking it.
///
/// The bug this pins down was invisible from inside a window: the turn ran, the reply
/// arrived, and the transcript looked right, because the state in memory was correct all
/// along. Only the record was wrong. A resumed `State` left `handle` unset, so the first
/// save minted a fresh id and wrote a *second* record — leaving the one the user opened
/// frozen at the moment they opened it, and the session list a little longer every time.
///
/// It compounded rather than merely duplicating. A record that never advances is resumed
/// from the same point forever, so the note upstream adds about dead quarantine references
/// was re-injected on every open, where it sits immediately before whatever the user types
/// next and quietly absorbs anything anaphoric — "tell me more" being answered about the
/// resume notice rather than about the conversation.
#[test]
fn resuming_a_session_writes_back_to_it_rather_than_forking() {
    let project = scratch("resume-continues");
    clean_up(&project);

    let mut conversation = bravebot_agent::Conversation::new();
    conversation.push(Message::user("remember the word haddock"));
    conversation.push(Message::assistant("haddock it is"));

    let trust = TrustStore::new();
    let todos = BTreeMap::new();

    let mut handle = Handle::begin(&project);
    handle.save(
        "remember the word haddock",
        Standing {
            conversation: &conversation.snapshot(),
            turns: 1,
            tokens: 10,
            todos: &todos,
            trust: &trust,
            programs: &TrustedPrograms::new(),
        },
    );
    let original = handle.id().to_string();

    // What `session.open` does with what it found on disk.
    let record = sessions::load(&project, &original).expect("the record should load");
    let mut state = bravebot_bridge::running::State::resumed(&project, &record, trust.clone());

    // What the worker does at the end of a turn: the same call, through the same handle.
    state.turns = 2;
    state.tokens = 25;
    let saved = state.handle.as_mut().expect("a resumed session already has its handle");
    saved.save(
        &state.first_prompt.clone().unwrap_or_default(),
        Standing {
            conversation: &state.conversation.snapshot(),
            turns: state.turns,
            tokens: state.tokens,
            todos: &state.todos,
            trust: &state.trust,
            programs: &state.programs,
        },
    );

    let listed = sessions::list(&project);
    assert_eq!(listed.len(), 1, "resuming must not leave a second session behind");
    assert_eq!(listed[0].id, original, "the continued session keeps its id");

    let reread = sessions::load(&project, &original).expect("the record should still load");
    assert_eq!(reread.turns, 2, "the turn landed in the session it was taken in");
    assert_eq!(reread.tokens, 25);
    assert_eq!(reread.title, "remember the word haddock", "the title survives the resume");

    clean_up(&project);
}
