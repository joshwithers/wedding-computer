// Collaborative scoped wedding docs (the "Notes" surface): tab labels,
// per-scope hints, live save status, presence + soft-lock strings.
export const docs = {
  'docs.heading': 'Notes',

  'docs.tab.everyone': 'Everyone',
  'docs.tab.vendors': 'Vendors only',
  'docs.tab.couple': 'Couple only',
  'docs.tab.private': 'Private',

  'docs.hint.shared': 'Visible to all vendors and the couple.',
  'docs.hint.vendors': 'Shared between vendors. The couple can’t see this.',
  'docs.hint.couple': 'Just for the couple. Vendors can’t see this.',
  'docs.hint.private': 'Only you can see this — your own private note.',

  'docs.empty': 'Nothing here yet.',
  'docs.loading': 'Loading…',
  'docs.readonlyTab': 'You can read this, but not edit it.',

  'docs.status.editing': 'Editing…',
  'docs.status.saving': 'Saving…',
  'docs.status.saved': 'Saved',
  'docs.status.saveFailed': 'Save failed',
  'docs.status.syncing': 'Syncing…',
  'docs.status.syncedSaved': 'Saved & synced',

  'docs.conflict.reloaded': 'This doc was changed elsewhere — loaded the latest version.',

  // Presence + soft editing-lock (Rung 2)
  'docs.editing.by': '{name} is editing',
  'docs.takeover': 'Take over editing',
  'docs.readonly.locked': 'Read-only while {name} edits',
  'docs.viewers.one': '{count} person here',
  'docs.viewers.other': '{count} people here',
} as const
