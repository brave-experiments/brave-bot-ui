/**
 * Looking at the folder a session is working in.
 *
 * Two operations — list a directory, hand a file to whichever app macOS assigns it — and one
 * thing that makes them safe: the renderer names a *session* and a path relative to that
 * session's directory, never a path. The roots live here, learned from what the agent answered
 * when a session was opened, forked or made. So the renderer cannot ask about a folder no session
 * of its is running in, which is the same promise `chooseDirectory` makes next door: it is never
 * handed a path it invented, and it cannot forge one.
 *
 * The lexical half of the check is `isSubpath` in `shared/files.ts`, and it is not enough on its
 * own — `foo/link` is a fine relative path and the link can point at `/etc`. So every resolution
 * here goes through `realpath` and must land inside the root's own `realpath`. A symlink out of
 * the project is refused rather than followed, including one whose *target* is what somebody
 * double-clicked: a link is a way out of the folder, and this panel is about the folder.
 *
 * Nothing here reads a file. The panel shows names and asks the operating system to open one;
 * contents never cross into the renderer, so this adds no route by which something the agent was
 * refused could arrive there anyway.
 */

import { shell } from 'electron'
import { readdirSync, realpathSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'
import { isProjectPath } from '../shared/recents'
import {
  ROWS_MAX,
  parseListing,
  type FileRow,
  type Listing,
  type OpenOutcome,
} from '../shared/files'

/**
 * Which session is working in which directory.
 *
 * In memory and for the life of the run only: unlike the recents list this is not a record of
 * anything, it is the answer to "what does a relative path mean for this session", and a stale
 * one on disk would be a root nothing is running in.
 */
const roots = new Map<string, string>()

/**
 * Remember where a session is working.
 *
 * The caller reads the handle off the agent's *answer* rather than off the request, for the
 * reason the fork list gives: a root on this map is then one the agent confirmed, not one the
 * renderer asserted. The directory is checked as a project path here so a malformed one never
 * becomes a key somebody can browse from.
 */
export function noteRoot(handle: string, directory: unknown): void {
  if (isProjectPath(directory)) roots.set(handle, directory)
}

/** Forget a session that has been closed. Its handle is no longer an answer to anything. */
export function forgetRoot(handle: string): void {
  roots.delete(handle)
}

/**
 * Where a session-and-subpath actually points, or `null` if it points nowhere this may look.
 *
 * `null` covers every refusal — an unknown session, a path that does not exist, a link that leads
 * out of the project — deliberately without distinguishing them. The caller has nothing different
 * to do about any of them, and a message that told the difference would tell the renderer whether
 * a path it may not read exists.
 */
function inside(handle: string, subpath: string): string | null {
  const root = roots.get(handle)
  if (root === undefined) return null
  try {
    const base = realpathSync(root)
    const target = subpath === '' ? base : realpathSync(join(base, subpath))
    if (target !== base && !target.startsWith(base + sep)) return null
    return target
  } catch {
    // No such path, or one this process cannot resolve. Either way there is nothing to list.
    return null
  }
}

/** What kind of thing an entry is, with a symlink resolved to what it points at. */
function kindOf(directory: string, entry: { name: string; isDirectory(): boolean; isSymbolicLink(): boolean }): FileRow['kind'] {
  if (entry.isDirectory()) return 'directory'
  if (!entry.isSymbolicLink()) return 'file'
  try {
    return statSync(join(directory, entry.name)).isDirectory() ? 'directory' : 'file'
  } catch {
    // A broken link. Shown as a file, because that is the row that does the least: opening it
    // fails and says so, where offering to expand it would promise children that cannot exist.
    return 'file'
  }
}

/**
 * One directory of a session's project, or `null` for anything this may not look at.
 *
 * Directories first and then names, case-insensitively — the order somebody scanning for a folder
 * reads in, and the one Finder and every editor sidebar already use.
 *
 * What comes back is `parseListing`'s output rather than the array this built, the same way the
 * layout and recents writers hand on the parsed value: the one judgement about this shape runs on
 * the way out as well, so a bug here cannot put a row on screen that the renderer would refuse.
 */
export function list(handle: string, subpath: string): Listing | null {
  const target = inside(handle, subpath)
  if (target === null) return null

  let entries
  try {
    entries = readdirSync(target, { withFileTypes: true })
  } catch {
    // A directory that cannot be read — permissions, or one that went away between the click and
    // the syscall. Nothing to say beyond that there is no listing.
    return null
  }

  const rows: FileRow[] = entries.map((entry) => ({
    name: entry.name,
    kind: kindOf(target, entry),
    hidden: entry.name.startsWith('.'),
  }))
  rows.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })

  return parseListing({
    path: subpath,
    rows: rows.slice(0, ROWS_MAX),
    truncated: rows.length > ROWS_MAX,
  })
}

/**
 * Hand a file to whichever app the system assigns its type.
 *
 * Only a regular file: a directory would open a Finder window nobody asked for, and a device or a
 * socket is not something to hand to `open(1)` at all. `shell.openPath` resolves to an empty
 * string when it worked and to a message when it did not, and that message is worth repeating —
 * somebody double-clicked and nothing happened, which is the one case here they can act on.
 */
export async function open(handle: string, subpath: string): Promise<OpenOutcome> {
  const target = inside(handle, subpath)
  // The same refusal for a path outside the project as for one that is not a file. The renderer
  // has no business telling those apart, and the person sees a row that would not open either way.
  if (target === null) return { status: 'failed', message: 'that is not a file in this project' }
  try {
    if (!statSync(target).isFile()) {
      return { status: 'failed', message: 'that is not a file' }
    }
  } catch {
    return { status: 'failed', message: 'that is not a file in this project' }
  }
  const failure = await shell.openPath(target)
  return failure === '' ? { status: 'opened' } : { status: 'failed', message: failure }
}
