/**
 * Where the recently-opened projects are kept.
 *
 * The same arrangement as the layout next door, and for the same measured reason: the
 * renderer runs on a `file://` origin whose storage Chromium discards between launches, so
 * anything meant to outlive a run lives in a file the main process owns.
 *
 * The main process records these itself rather than taking them from the renderer. That
 * keeps the promise `chooseDirectory` already makes — the renderer is never handed a path it
 * invented, and now it cannot forge one into the list either. It can read the list and it
 * can ask to open something on it; it has no way to write to it.
 */

import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { RECENTS_MAX, parseRecents, withMostRecent } from '../shared/recents'

const file = (): string => join(app.getPath('userData'), 'recents.json')

/** The projects opened before, newest first. Never throws; an unreadable file is empty. */
export function recents(): string[] {
  try {
    return parseRecents(JSON.parse(readFileSync(file(), 'utf8'))).directories
  } catch {
    return []
  }
}

/**
 * Record that a project was opened. Says whether the list actually changed.
 *
 * The caller uses that to decide whether to rebuild the menu — the recents submenu is the
 * one part of it whose *structure* varies, and rebuilding is expensive enough to be worth
 * not doing when reopening the project that was already at the front.
 *
 * What lands on disk is the parsed list and never the array this happened to build, so a bug
 * here cannot leave something in the file that outlives the session that caused it.
 */
export function noteProject(directory: string): boolean {
  const before = recents()
  const after = withMostRecent(before, directory)
  if (before.length === after.length && before.every((old, index) => old === after[index])) {
    return false
  }
  try {
    writeFileSync(file(), JSON.stringify(parseRecents({ directories: after })), 'utf8')
  } catch {
    // A convenience list that cannot be written down is not worth an error on screen.
    return false
  }
  return after.length <= RECENTS_MAX
}
