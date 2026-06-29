// Form builders: enquiry, booking, contract, forms list.
// `forms.date.*` label the natural-language countdown shown under a selected
// wedding/enquiry date on public forms. {duration} is filled in the browser
// with locale-formatted units (e.g. "1 year, 2 weeks").
export const forms = {
  'forms.date.today': "That's today",
  'forms.date.away': '{duration} away',
  'forms.date.ago': '{duration} ago',
  'forms.address.placeholder': 'Start typing a place or address…',

  // Public form renderer (shared across enquiry / custom / booking forms).
  'forms.public.select': 'Select…',
  'forms.public.country': 'Start typing a country…',
  'forms.public.step': 'Step {n} of {total}',
  'forms.public.continue': 'Continue',
  'forms.public.back': 'Back',
  'forms.public.maxFileSize': 'Max 10MB',
  'forms.public.poweredBy': 'Powered by',
  'forms.public.unavailable': 'This form is no longer available.',
  'forms.public.verificationFailed': 'Verification failed. Please try again.',
  'forms.public.required': '{label} is required.',
  'forms.public.fileTooLarge': '{label}: that file is too large or an unsupported type (max 10MB).',
  'forms.public.tooLong': '{label} is too long.',
  'forms.public.invalidEmail': 'Please enter a valid email address.',
  // Thank-you / confirmation states.
  'forms.public.submitted': 'Submitted successfully',
  'forms.public.thankYou': 'Thanks — we have received your response.',
  'forms.public.enquirySent': 'Enquiry sent',
  'forms.public.enquirySentBody': "Your enquiry has been sent to {vendor}. They'll be in touch soon.",
  'forms.public.bookingConfirmed': 'Booking confirmed',
  'forms.public.bookingConfirmedBody': 'Your vendor will be in touch about next steps.',
  'forms.public.noimReady': 'Your NOIM PDF is ready to download.',
  'forms.public.noimDesc': 'Click below to generate and download your completed Notice of Intended Marriage.',
  'forms.public.downloadNoim': 'Download NOIM PDF',
} as const
