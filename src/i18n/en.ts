// English — the source dictionary. Every user-facing string in the app keys
// off this file; its keys are the canonical set (`MessageKey` in ./index.ts),
// so adding a string here is what makes it translatable everywhere else.
//
// Conventions:
// - Keys are dot-namespaced by surface: `nav.contacts`, `dashboard.title`.
// - Interpolation slots use {curly} names: `t('hello', { name })`.
// - Plural pairs use `.one` / `.other` suffixes and are read via `tp()`.

export const en = {
  // ── Common actions ──
  'common.save': 'Save',
  'common.saveChanges': 'Save changes',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.search': 'Search',
  'common.viewAll': 'View all',
  'common.details': 'Details',
  'common.signOut': 'Sign out',
  'common.enquiry.one': '{count} enquiry',
  'common.enquiry.other': '{count} enquiries',
  'common.booking.one': '{count} booking',
  'common.booking.other': '{count} bookings',

  // ── Sidebar navigation ──
  'nav.dashboard': 'Dashboard',
  'nav.contacts': 'Contacts',
  'nav.weddings': 'Weddings',
  'nav.calendar': 'Calendar',
  'nav.invoices': 'Invoices',
  'nav.emails': 'Emails',
  'nav.setup': 'Setup',
  'nav.forms': 'Forms',
  'nav.enquiryForm': 'Enquiry Form',
  'nav.bookingForm': 'Booking Form',
  'nav.contract': 'Contract',
  'nav.checklists': 'Checklists',
  'nav.quoteCalculator': 'Quote Calculator',
  'nav.team': 'Team',
  'nav.import': 'Import',
  'nav.analytics': 'Analytics',
  'nav.subscription': 'Subscription',
  'nav.referEarn': 'Refer & earn',
  'nav.yourData': 'Your Data',
  'nav.yourProfile': 'Your Profile',
  'nav.settings': 'Settings',
  'nav.admin': 'Admin',
  'nav.toggleMenu': 'Toggle menu',

  // ── Dashboard ──
  'dashboard.title': 'Dashboard',
  'dashboard.contacts': 'Contacts',
  'dashboard.newLeads': 'New leads',
  'dashboard.booked': 'Booked',
  'dashboard.revenue': 'Revenue',
  'dashboard.upcomingWeddings': 'Upcoming weddings',
  'dashboard.noUpcomingWeddings': 'No upcoming weddings',
  'dashboard.comingUp': 'Coming up',
  'dashboard.noUpcomingEvents': 'No upcoming events',
  'dashboard.checklists': 'Checklists',
  'dashboard.templates': 'Templates',
  'dashboard.recentContacts': 'Recent contacts',
  'dashboard.overduePayments': 'Overdue payments',

  // ── Account: language & region ──
  'account.languageRegion': 'Language & region',
  'account.languageRegionHint':
    'Language and formats for dates shown to you. Times follow your timezone.',
  'account.language': 'Language',
  'account.timezone': 'Timezone',
} as const
