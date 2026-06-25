// CRM contacts + import.
export const contacts = {
  'contacts.status.new': 'New',
  'contacts.status.contacted': 'Contacted',
  'contacts.status.meeting': 'Meeting',
  'contacts.status.quoted': 'Quoted',
  'contacts.status.booked': 'Booked',
  'contacts.status.completed': 'Completed',
  'contacts.status.lost': 'Lost',
  'contacts.status.archived': 'Archived',
  'contacts.status.unknown': 'Unknown',
  'contacts.import.field.extra': 'Keep as extra detail',
  'contacts.import.field.createdAt': 'Original created date',
  'contacts.import.preview.extraColumn': 'Extra details',
  'contacts.import.options.title': 'Options',
  'contacts.import.options.createWeddings': 'Create weddings for booked contacts',
  'contacts.import.options.createWeddingsHelp':
    'Each contact imported with a booked or completed status and a wedding date also gets a wedding, a calendar booking, and a link back to the contact. No invitations are sent — your past clients will not be emailed.',
  'contacts.import.weddingsCreated': 'Weddings created',

  // Lost-reason inline form
  'contacts.lost.reason': 'Reason for losing',
  'contacts.lost.reasonPrompt': 'Select a reason…',
  'contacts.lost.notePlaceholder': 'Add a note (optional)',
  'contacts.lost.confirm': 'Mark as lost',
} as const
