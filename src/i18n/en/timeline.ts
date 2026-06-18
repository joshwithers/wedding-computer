// Unified wedding timeline / run sheet.
export const timeline = {
  'timeline.heading': 'Run sheet',
  'timeline.subhead': 'The wedding-day timeline — sections, times, and who’s on each.',

  // Daylight strip — sun times for the wedding's date + location.
  'timeline.sun.sunrise': 'Sunrise',
  'timeline.sun.sunset': 'Sunset',
  'timeline.sun.goldenHour': 'Golden hour',
  'timeline.sun.approx': '≈ approx',
  'timeline.sun.approxHint': 'Estimated from the region — set a precise venue address for exact times.',

  // Expected-weather note (AI, from the region's climate).
  'climate.heading': 'Expected weather',
  'climate.loading': 'Checking the typical weather for the season…',
  'climate.empty': 'Add a location and date to see the weather you can typically expect.',
  'climate.error': 'Couldn’t generate a weather note right now — try again later.',

  'timeline.managedBy': 'Timeline managed by {name}',
  'timeline.managedByCoupleHint': 'Until a planner or venue is added, the couple manages the timeline.',
  'timeline.managedByVendorHint': 'Until a planner or venue is added, {name} manages the timeline.',

  'timeline.add': 'Add section',
  'timeline.empty': 'No sections yet. Add the first moment of the day above.',
  'timeline.keyMoment': 'Key moment',

  'timeline.field.title': 'What’s happening',
  'timeline.field.titlePlaceholder': 'e.g. First dance',
  'timeline.field.start': 'Start',
  'timeline.field.end': 'End',
  'timeline.field.location': 'Location',
  'timeline.field.locationPlaceholder': 'Where',
  'timeline.field.category': 'Part of day',
  'timeline.field.visibility': 'Who can see it',
  'timeline.field.details': 'Details',

  // Liquid timing (durations + relative anchoring).
  'timeline.field.liquid': 'Relative timing & duration',
  'timeline.field.duration': 'Duration (min)',
  'timeline.field.pinned': 'Fixed time (won’t shift)',
  'timeline.field.startRel': 'Start',
  'timeline.field.anchorItem': 'Relative to',
  'timeline.field.offset': 'Gap (minutes)',
  'timeline.anchor.none': 'At a set time',
  'timeline.anchor.after': 'After…',
  'timeline.anchor.before': 'Before…',
  'timeline.anchor.afterGroup': 'After a section ends',
  'timeline.anchor.beforeGroup': 'Before a section starts',
  'timeline.anchor.sunGroup': 'Relative to daylight',
  'timeline.anchor.beforeSunset': 'Before sunset',
  'timeline.anchor.afterSunset': 'After sunset',
  'timeline.anchor.beforeGolden': 'Golden hour',
  'timeline.anchor.beforeSunrise': 'Before sunrise',
  'timeline.anchor.afterSunrise': 'After sunrise',
  'timeline.rel.after': 'after {name}',
  'timeline.rel.before': 'before {name}',
  'timeline.conflict': 'Check timing',

  // Live mode (running the day).
  'timeline.start': 'Start',
  'timeline.startNow': 'Mark as started now',
  'timeline.unstart': 'Not started yet',
  'timeline.started': 'started {time}',
  'timeline.live': 'Live',
  'timeline.behind': 'running {n} min behind',
  'timeline.ahead': 'running {n} min ahead',
  'timeline.onSchedule': 'on schedule',
  'timeline.pastSunset': 'After sunset',
  'timeline.endLive': 'End live',
  'timeline.endLiveConfirm': 'Clear all recorded start times and leave live mode?',

  'timeline.cat.getting_ready': 'Getting ready',
  'timeline.cat.ceremony': 'Ceremony',
  'timeline.cat.portraits': 'Portraits',
  'timeline.cat.reception': 'Reception',
  'timeline.cat.other': 'Other',

  'timeline.vis.couple': 'Everyone',
  'timeline.vis.vendors': 'Vendors only',
  'timeline.vis.private': 'Just me',

  'timeline.who': 'Who’s on it',
  'timeline.addPerson': 'Add person',
  'timeline.personPlaceholder': 'Name or role…',

  'timeline.save': 'Save',
  'timeline.cancel': 'Cancel',
  'timeline.edit': 'Edit',
  'timeline.remove': 'Remove',
  'timeline.confirmRemove': 'Remove this section?',

  'timeline.pending': 'Sent to {name} to approve',
  'timeline.readOnlyRow': 'Read-only — owned by another vendor',

  'timeline.pendingHeading': 'Pending changes',
  'timeline.requestedBy': 'Requested by {name}',
  'timeline.awaiting': 'Awaiting the timeline lead’s approval',
  'timeline.approve': 'Approve',
  'timeline.decline': 'Decline',
  'timeline.op.create': 'Add',
  'timeline.op.update': 'Change',
  'timeline.op.delete': 'Remove',

  'timeline.addToCalendar': 'Add to my calendar',
  'timeline.inCalendar': 'In your calendar — tap to remove',

  'timeline.feed.heading': 'Your wedding calendar',
  'timeline.feed.desc': 'Subscribe to this link in Apple Calendar, Google Calendar or Outlook. The sections you add to your calendar show up here automatically.',
  'timeline.feed.label': 'Calendar feed link',
} as const
