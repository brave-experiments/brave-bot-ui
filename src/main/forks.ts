/**
 * Where the record of which session came out of which is kept.
 *
 * The same arrangement as the recents list next door, and for the same two reasons. The
 * renderer's storage does not survive a launch, so anything meant to outlive one lives in a file
 * the main process owns. And the main process writes this itself, from what the *agent* answered
 * rather than from what the renderer asked for — the window can read the list and it can ask for
 * a fork, but it has no way to write a line into it.
 *
 * The agent's own record cannot hold this; `src/shared/forks.ts` says why.
 */

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type Fork, parseForks, withFork } from '../shared/forks'

const file = (): string => join(app.getPath('userData'), 'forks.json')

/** Every fork taken before, newest first. Never throws; an unreadable file is empty. */
export function forks(): Fork[] {
  try {
    return parseForks(JSON.parse(readFileSync(file(), 'utf8'))).forks
  } catch {
    return []
  }
}

/**
 * Record that one session was cut out of another.
 *
 * What lands on disk is the parsed list and never the array this happened to build, so a bug
 * here cannot leave something in the file that outlives the session that caused it.
 *
 * A failure is swallowed. The fork itself has already happened — it is a live session with a
 * conversation in it — and losing the line that says where it came from costs a banner, which is
 * not worth an error on screen over.
 */
export function noteFork(fork: Fork): void {
  try {
    const after = withFork(forks(), fork)
    writeFileSync(file(), JSON.stringify(parseForks({ forks: after })), 'utf8')
  } catch {
    // Nothing to do about it, and nothing worth saying.
  }
}
