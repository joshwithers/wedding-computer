// Couples community — season + year cohorts, one room per country.
export const community = {
  // Layout / nav
  'community.title': 'Community',
  'community.signOut': 'Sign out',

  // Hub
  'community.hub.subtitle': 'Meet couples marrying around the same time and place.',
  'community.hub.yourRooms': 'Your communities',
  'community.hub.empty': "You haven't joined a community yet.",
  'community.hub.discover': 'Join your community',

  // Cohort label, e.g. "Australia · Autumn 2027"
  'community.cohort.label': '{country} · {season} {year}',

  // Join
  'community.join.title': 'Join your wedding community',
  'community.join.blurb': 'Chat with couples marrying in {label} — share ideas, ask questions, swap recommendations.',
  'community.join.cta': 'Join {label}',
  'community.join.member': "You're in {label}",
  'community.join.open': 'Open community',
  'community.join.needsDate': 'Add your wedding date to meet couples marrying around the same time.',
  'community.join.needsDateCta': 'Add your date',
  'community.join.pickCountry': 'Choose your country to find your community.',
  'community.join.country': 'Country',
  'community.join.state': 'State or province (optional)',
  'community.join.displayName': 'Display name',
  'community.join.displayNameHint': 'How other couples see you. Your full name, exact date and venue are never shown.',
  'community.join.confirm': 'Join community',

  // Room
  'community.room.members.one': '{count} member',
  'community.room.members.other': '{count} members',
  'community.room.newThread': 'Start a conversation',
  'community.room.empty': 'No conversations yet — start the first one.',
  'community.room.emptyFiltered': 'No conversations from {state} yet.',
  'community.room.allAreas': 'All areas',
  'community.room.filterHint': 'Filter by area',
  'community.room.leave': 'Leave',
  'community.room.leaveConfirm': 'Leave this community? You can rejoin anytime.',
  'community.room.joinPrompt': 'Join this community to start and reply to conversations.',

  // Thread
  'community.thread.titleLabel': 'Title',
  'community.thread.titlePlaceholder': 'What do you want to talk about?',
  'community.thread.bodyPlaceholder': 'Share the details…',
  'community.thread.post': 'Post',
  'community.thread.cancel': 'Cancel',
  'community.thread.back': 'Back to {label}',
  'community.thread.replies.one': '{count} reply',
  'community.thread.replies.other': '{count} replies',
  'community.thread.noReplies': 'No replies yet — be the first to chime in.',
  'community.thread.locked': 'This conversation is locked.',

  // Reply
  'community.reply.placeholder': 'Write a reply…',
  'community.reply.send': 'Reply',

  // Post actions
  'community.post.edit': 'Edit',
  'community.post.delete': 'Delete',
  'community.post.deleteConfirm': 'Delete this post?',
  'community.post.save': 'Save',
  'community.post.cancel': 'Cancel',
  'community.post.edited': 'edited',
  'community.post.report': 'Report',
  'community.post.reportDone': 'Thanks — our team will take a look.',
  'community.post.conflict': 'This post changed while you were editing — showing the latest version.',

  // Vendor join (explicit country + season + year picker on hub)
  'community.vendor.joinTitle': 'Join a community as a vendor',
  'community.vendor.joinBlurb': 'Help couples planning in a particular season and country — badged as a vendor.',
  'community.join.season': 'Season',
  'community.join.year': 'Year',
  'community.join.vendorDisplayNameHint': 'How couples see you — usually your business name.',

  // Badge
  'community.badge.vendor': 'Vendor',

  // Privacy + errors
  'community.privacy.note': 'Couples see your display name and area — never your exact date, venue, or contact details.',
  'community.rateLimited': "You're posting a little fast — give it a minute and try again.",
  'community.error.generic': 'Something went wrong. Please try again.',
  'community.error.notMember': 'Join this community first.',
  'community.error.titleRequired': 'Add a title for your conversation.',
  'community.error.bodyRequired': 'Write something to post.',
  'community.error.country': 'Choose your country.',

  // Seasons (hemisphere-correct slug is chosen in lib/season.ts; this just labels it)
  'community.season.summer': 'Summer',
  'community.season.autumn': 'Autumn',
  'community.season.winter': 'Winter',
  'community.season.spring': 'Spring',
} as const
