// Form builders: enquiry, booking, contract, forms list.
// `forms.date.*` label the natural-language countdown shown under a selected
// wedding/enquiry date on public forms. {duration} is filled in the browser
// with locale-formatted units (e.g. "1 year, 2 weeks").
export const forms = {
  'forms.date.today': "That's today",
  'forms.date.away': '{duration} away',
  'forms.date.ago': '{duration} ago',
  'forms.address.placeholder': 'Start typing a place or address…',
} as const
