// Transactional email content. Rendered inside runWithI18n() with the
// recipient's locale, so a vendor reads notifications in their own language.
export const email = {
  // "Run sheet updated" (timeline team notification)
  'email.timeline.updated.subject': 'The run sheet for {wedding} was updated',
  'email.timeline.updated.heading': 'The run sheet for {wedding} was updated',
  'email.timeline.updated.body':
    "Someone on the wedding changed the run sheet — times, items, or who's doing what. Open it to see the latest, so you're working from the current version on the day.",
  'email.timeline.updated.cta': 'View the run sheet',
  'email.timeline.updated.footer': "You're getting this because you have items on this wedding's run sheet.",
  'email.timeline.updated.preheader': 'The run sheet for {wedding} has changed',

  // Timeline change proposed → needs the planner/venue's approval
  'email.timeline.requested.subject': 'Timeline change for {wedding} needs your approval',
  'email.timeline.requested.heading': 'Timeline change awaiting your approval',
  'email.timeline.requested.body':
    'Hi {manager}, {requester} proposed a change to the timeline for {wedding}. Nothing is applied until you approve it.',
  'email.timeline.requested.cta': 'Review change',
  'email.timeline.requested.preheader': '{requester} proposed a timeline change for {wedding}',

  // Timeline change decided (approved / declined) → back to the requester
  'email.timeline.decided.subject.approved': 'Your timeline change for {wedding} was approved',
  'email.timeline.decided.subject.declined': 'Your timeline change for {wedding} was declined',
  'email.timeline.decided.heading.approved': 'Timeline change approved',
  'email.timeline.decided.heading.declined': 'Timeline change declined',
  'email.timeline.decided.body.approved':
    "Hi {requester}, {decider} approved your timeline change for {wedding}. It's live now — calendars for everyone on the wedding have been updated.",
  'email.timeline.decided.body.declined':
    'Hi {requester}, {decider} declined your timeline change for {wedding}. The timeline is unchanged. Get in touch with them if you want to talk it through.',
  'email.timeline.decided.cta': 'View wedding',
  'email.timeline.decided.preheader.approved': 'Your timeline change for {wedding} was approved',
  'email.timeline.decided.preheader.declined': 'Your timeline change for {wedding} was declined',
} as const
