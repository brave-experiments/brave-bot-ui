// The running order.
//
// This is the file to edit when a feature lands: add a scene under `scenes/` and add it here,
// in the place in the story it belongs. Nothing else needs touching — `demo.mjs` checks this
// list against the directory and refuses to run if the two disagree, so a scene written and
// never listed is an error rather than a scene that silently never plays.
//
// The order is a story rather than a feature list: find a session, watch a turn happen and be
// questioned, then read the record it left, arrange the window around it, and look at what the
// agent touched. Forking and export come last because they are things done to a conversation
// that already exists.
export const SCENES = [
  '00-open',
  '01-sessions',
  // `live: true` — filmed only with --live. Third, so a viewer meets the thing the app is for
  // before meeting the furniture around it: a real turn, and the questions it stops to ask.
  // It also leaves the session richer than it found it — approval cards in the transcript,
  // confined content in the context panel — which every scene after it then has to show.
  '02-live',
  '03-transcript',
  '04-columns',
  '05-context',
  '06-file-tree',
  '07-markdown',
  '08-fork',
  '09-export',
  '10-commands',
  '99-close',
]
