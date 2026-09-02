/**
 * Where a bot's definition is kept.
 *
 * The same arrangement as the forks and the recents next door: the list lives under its own key in
 * `state.ts`. What is different is that a bot is mostly a preference somebody types, so unlike
 * those two this module does take dictation — and it takes it four fields at a time, which is the
 * whole of what a window may say about a bot.
 *
 * The rest of the record is not dictation and has no writer yet: `session` and `archived` are
 * reports about a conversation, and nothing here starts one. They stay null and zero until
 * something does.
 */

import { type Bot, botOf, isSlug, withBot } from '../shared/bots'
import { putBots, readState } from './state'

/** Every bot defined. Never throws; an unreadable file is no bots. */
export function bots(): Bot[] {
  return readState().bots
}

/** The one with this slug, or `null`. */
export function bot(slug: unknown): Bot | null {
  return isSlug(slug) ? botOf(bots(), slug) : null
}

/** Write a bot down, replacing whatever shared its slug, and stamp when that happened. */
export function saveBot(next: Bot): void {
  putBots(withBot(bots(), { ...next, updated: Date.now() }))
}
