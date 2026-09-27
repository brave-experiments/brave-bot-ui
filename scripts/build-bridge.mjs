// Builds bravebot-rpc and the file helper, with the agent's credentials built in when they can be
// found.
//
// bravebot reads its backend credentials when it is COMPILED (see crates/config/build.rs upstream).
// That is on purpose: a release binary is built where the secrets are and then used anywhere, so it
// does not ask for them again in every directory it starts in.
//
// This matters more for the app than for the command line. `bravebot` runs in a terminal, which
// usually has direnv loaded, so a binary built without credentials still finds them there. An app
// started from Finder, the Start menu or `npm run dev` has no such setup, so a binary built without
// credentials fails at its first request to the model, with
// "SERVICES_KEY_AICHAT is not set and was not built in".
//
// So this builds through direnv when the agent checkout has an allowed .envrc, and says plainly
// what will happen when it does not. It is a Node script, not a shell script, so the same command
// works on Windows.
import { spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('../', import.meta.url))
const CARGO = ['cargo', 'build', '-p', 'bravebot-bridge', '-p', 'bravebot-ui-files']

const UNCONFIGURED = `warning: building bravebot-rpc WITHOUT backend credentials.

  The app will start, list sessions, and open them. The first inference request will
  fail with "SERVICES_KEY_AICHAT is not set and was not built in".

  To fix: copy .envrc.example to .envrc in vendor/bravebot, run \`direnv allow\` there,
  then build again, or set the variables it lists in this shell first. (.envrc is ignored
  by the agent's own .gitignore, so it does not show up as a dirty submodule.) If you
  already have one in an older sibling checkout, BRAVEBOT_DIR pointed at that checkout is
  read for credentials instead.`

/**
 * Picks the command to run and the message to print before it. `direnv` is `allowed`, `denied`
 * (there is an .envrc that direnv has not been told to trust) or `absent` (no direnv, or no .envrc).
 */
export function buildPlan({ agent, agentExists, configured, direnv, args = [] }) {
  const cargo = [...CARGO, ...args]
  if (!agentExists) {
    return { command: cargo, warning: `warning: no credential checkout at ${agent} (set BRAVEBOT_DIR).\n         Building without credentials; inference will fail at run time.` }
  }
  // The shell already has the credentials, so cargo runs as it is.
  if (configured) return { command: cargo }
  if (direnv === 'allowed') return { command: ['direnv', 'exec', agent, ...cargo], note: `building with credentials from ${join(agent, '.envrc')}` }
  const denied = direnv === 'denied' ? `warning: ${join(agent, '.envrc')} is not allowed. Run: direnv allow ${agent}\n` : ''
  return { command: cargo, warning: denied + UNCONFIGURED }
}

function run([program, ...args]) {
  return spawnSync(program, args, { cwd: REPO, stdio: 'inherit' })
}

function direnvState(agent) {
  if (!existsSync(join(agent, '.envrc'))) return 'absent'
  const probe = spawnSync('direnv', ['exec', agent, 'true'], { stdio: 'ignore' })
  if (probe.error) return 'absent'
  return probe.status === 0 ? 'allowed' : 'denied'
}

function main() {
  // A submodule that was never set up is an empty directory. Cargo's error for that only says
  // that Cargo.toml is missing, and does not name the command that fixes it.
  if (!existsSync(join(REPO, 'vendor', 'bravebot', 'Cargo.toml'))) {
    console.error('error: vendor/bravebot is empty. Run: git submodule update --init')
    return 1
  }

  // `git pull` can change the agent version this repository pins without updating the submodule,
  // and the next build would then compile the wrong version. `git submodule status` marks that
  // case with a leading `+`.
  const status = spawnSync('git', ['-C', REPO, 'submodule', 'status', 'vendor/bravebot'], { encoding: 'utf8' })
  if (status.stdout?.startsWith('+')) {
    console.error('warning: vendor/bravebot is not at the pinned revision.')
    console.error('         Run `git submodule update` to build what this branch pins.')
  }

  // By default, credentials come from `vendor/bravebot`, the same checkout that
  // `crates/bravebot-bridge/Cargo.toml` compiles. `BRAVEBOT_DIR` can point somewhere else, as can
  // `BUA_AGENT_DIR`, its name from before the agent was renamed. That only changes where the
  // credentials come from: cargo still compiles the submodule.
  const named = process.env.BRAVEBOT_DIR || process.env.BUA_AGENT_DIR || join(REPO, 'vendor', 'bravebot')
  const agentExists = existsSync(named)
  // direnv remembers an allowed .envrc by its real path, with any symlinks resolved.
  const agent = agentExists ? realpathSync(named) : named

  const plan = buildPlan({
    agent,
    agentExists,
    configured: Boolean(process.env.SERVICES_KEY_AICHAT),
    direnv: agentExists ? direnvState(agent) : 'absent',
    args: process.argv.slice(2),
  })
  if (plan.warning) console.error(plan.warning)
  if (plan.note) console.error(plan.note)
  const result = run(plan.command)
  if (result.error) {
    console.error(`error: could not run ${plan.command[0]}: ${result.error.message}`)
    return 1
  }
  return result.status ?? 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
