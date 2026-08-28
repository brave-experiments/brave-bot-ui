#!/usr/bin/env bash
# A live turn through bua-rpc, end to end.
#
# Needs the agent's credentials, so it must run in a shell where direnv has loaded
# brave-user-agent's .envrc. It drives a real model: expect it to cost a few tokens and
# take a few seconds.
#
# Usage, from anywhere:
#     ~/repos/brave-user-agent-ui/scripts/smoke-turn.sh [working-directory]
#
# The working directory defaults to brave-user-agent itself, so the agent has something
# real to read. Nothing is written: the prompt only asks a question, and this session
# declines to trust the directory anyway, so any write would be shown rather than applied.

set -uo pipefail

UI="$HOME/repos/brave-user-agent-ui"
AGENT="$HOME/repos/brave-user-agent"
WORKDIR="${1:-$AGENT}"
RPC="$UI/target/debug/bua-rpc"

if [ ! -x "$RPC" ]; then
  echo "building bua-rpc..." >&2
  ( cd "$UI" && cargo build -p bua-bridge ) || exit 1
fi

if [ -z "${SERVICES_KEY_AICHAT:-}" ]; then
  cat >&2 <<'MSG'
No credentials in this shell. bua-rpc is built unconfigured, so it reads them from the
environment at run time. Run this from a shell where direnv has loaded the agent's
.envrc, or wrap it:

    direnv exec ~/repos/brave-user-agent ~/repos/brave-user-agent-ui/scripts/smoke-turn.sh

MSG
  exit 1
fi

echo "# working directory: $WORKDIR" >&2
echo "# ---- transcript ----" >&2

# Session 1 is minted by session.new. Trust is declined, so every write would be shown;
# the prompt asks a question rather than requesting one.
{
  printf '%s\n' "{\"id\":1,\"method\":\"session.new\",\"params\":{\"directory\":\"$WORKDIR\"}}"
  printf '%s\n' '{"id":2,"method":"trust.reply","params":{"session":"s1","trusted":false}}'
  printf '%s\n' '{"id":3,"method":"turn.send","params":{"session":"s1","prompt":"In one sentence, what is the purpose of crates/core/src/label.rs?"}}'
  # Hold stdin open while the turn runs. Closing it would refuse any pending write and
  # end the process, which is correct behaviour and not what we want to observe here.
  sleep 120
} | "$RPC" | while IFS= read -r line; do
  python3 - "$line" <<'PY'
import json, sys
try:
    m = json.loads(sys.argv[1])
except Exception:
    print("RAW:", sys.argv[1]); sys.exit()

if "event" in m:
    name, d = m["event"], m.get("data", {})
    if name == "agent.ready":       print(f"[ready] agent {d.get('build')}")
    elif name == "phase":           print(f"[phase] {d.get('phase')}")
    elif name == "narration":       print(f"[says ] {d.get('text','')[:120]}")
    elif name == "tool.started":    print(f"[tool ] {d.get('verb')}({d.get('target')}) ...")
    elif name == "tool.finished":   print(f"[tool ] {d.get('verb')}({d.get('target')}) -> {d.get('note')}")
    elif name == "landed":          print(f"[land ] {d.get('landing')}")
    elif name == "quarantined":     print(f"[quar ] {d.get('origin')} ({d.get('lines')} lines, {d.get('reach')})")
    elif name == "confirm.request": print(f"[ASK  ] write {d.get('path')} (+{d.get('added')}/-{d.get('removed')})")
    elif name == "turn.done":
        print(f"[done ] {d.get('steps')} steps, {d.get('tokens')} tokens, clean={d.get('clean')}")
        print(f"[reply] {d.get('reply','')[:600]}")
        sys.exit(17)
    elif name == "turn.error":
        print(f"[ERROR] {d.get('kind')}: {d.get('message')}")
        sys.exit(17)
    elif name == "audit":           pass  # too noisy for a smoke test
    else:                           print(f"[{name}] {json.dumps(d)[:160]}")
elif "error" in m:                  print(f"[fail ] id={m['id']} {m['error']['code']}: {m['error']['message']}")
else:                               print(f"[ok   ] id={m['id']} {json.dumps(m.get('ok'))[:160]}")
PY
  [ $? -eq 17 ] && break
done

echo "# ---- end ----" >&2
echo "# the session should now appear in: bua --resume  (run in $WORKDIR)" >&2
