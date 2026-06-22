// First-run onboarding wizard (vendor + couple paths).
export const onboarding = {
  // Common
  'onboarding.step': 'Step {current} of {total}',
  'onboarding.continue': 'Continue',
  'onboarding.yourName': 'Your name',

  // Chooser
  'onboarding.start.title': 'Get started',
  'onboarding.start.heading': 'Welcome!',
  'onboarding.start.subtitle': 'What brings you to Wedding Computer?',
  'onboarding.start.namePrompt': "First, what's your name?",
  'onboarding.start.namePlaceholder': 'Your name',
  'onboarding.start.save': 'Save',
  'onboarding.start.vendor.title': "I'm a wedding professional",
  'onboarding.start.vendor.desc': 'Set up your business — manage contacts, calendar, invoices and more.',
  'onboarding.start.couple.title': "I'm planning a wedding",
  'onboarding.start.couple.desc': 'Create your wedding — track vendors, budget, and details all in one place.',

  // Business step
  'onboarding.business.title': 'Set up your business',
  'onboarding.business.subtitle': 'Tell us about your business to get started.',
  'onboarding.business.businessName': 'Business name',
  'onboarding.business.whatYouDo': 'What do you do?',
  'onboarding.business.chooseAtLeastOne': '(choose at least one)',
  'onboarding.business.emailLabel': 'Your email address',
  'onboarding.business.emailHelp': 'Choose a handle for sending and receiving emails on Wedding Computer.',
  'onboarding.business.emailPlaceholder': 'yourname',

  // Category labels (what kind of vendor)
  'onboarding.category.celebrant': 'Celebrant',
  'onboarding.category.officiant': 'Officiant',
  'onboarding.category.photographer': 'Photographer',
  'onboarding.category.videographer': 'Videographer',
  'onboarding.category.florist': 'Florist',
  'onboarding.category.planner': 'Planner',
  'onboarding.category.venue': 'Venue',
  'onboarding.category.stylist': 'Stylist',
  'onboarding.category.caterer': 'Caterer',
  'onboarding.category.dj': 'DJ',
  'onboarding.category.band': 'Band',
  'onboarding.category.hair': 'Hair stylist',
  'onboarding.category.makeup': 'Makeup artist',
  'onboarding.category.cake': 'Cake maker',
  'onboarding.category.stationery': 'Stationer',
  'onboarding.category.other': 'Other',

  // Validation errors
  'onboarding.error.pickCategory': 'Pick at least one category',
  'onboarding.error.handleShort': 'Email handle must be at least 3 characters',
  'onboarding.error.handleTaken': 'That email handle is already taken',
  'onboarding.error.handleReserved': 'That email handle is reserved — please choose another',
  'onboarding.error.businessNameRequired': 'Business name is required',

  // Profile step
  'onboarding.profile.metaTitle': 'Your details',
  'onboarding.profile.heading': 'Add your details',
  'onboarding.profile.subtitle': 'These show on your profile and enquiry form. You can skip and add them later.',
  'onboarding.profile.phone': 'Phone',
  'onboarding.profile.location': 'Location',
  'onboarding.profile.locationPlaceholder': 'City or region you serve',
  'onboarding.profile.website': 'Website',
  'onboarding.profile.instagram': 'Instagram',
  'onboarding.profile.instagramPlaceholder': '@yourhandle',
  'onboarding.profile.bio': 'Short bio',
  'onboarding.profile.bioPlaceholder': 'A sentence or two about what you do',
  'onboarding.profile.skip': 'Skip for now',

  // Final step
  'onboarding.next.metaTitle': "You're all set",
  'onboarding.next.heading': "You're all set, {name}",
  'onboarding.next.gotoDashboard': 'Go to your dashboard',
  'onboarding.next.checklistNote': "You'll find a setup checklist there to finish the basics.",
  'onboarding.next.joined.title.one': "You're already on {count} wedding",
  'onboarding.next.joined.title.other': "You're already on {count} weddings",
  'onboarding.next.joined.subtitle': "These were set up by couples and vendors who added you before you even signed up — they're waiting in your dashboard.",
  'onboarding.next.joined.dateTbc': 'Date TBC',
  'onboarding.next.joined.more': '+{count} more in your dashboard',

  // Couple wedding step
  'onboarding.wedding.metaTitle': 'Plan your wedding',
  'onboarding.wedding.title': 'Plan your wedding',
  'onboarding.wedding.subtitle': 'Tell us about your day. You can always update these details later.',
  'onboarding.wedding.partnerName': "Your partner's name",
  'onboarding.wedding.partnerPlaceholder': 'Optional — you can add this later',
  'onboarding.wedding.date': 'Wedding date',
  'onboarding.wedding.dateHelp': "Don't have a date yet? No worries — leave it blank.",
  'onboarding.wedding.location': 'Location',
  'onboarding.wedding.locationPlaceholder': 'City or venue name',
  'onboarding.wedding.create': 'Create my wedding',
  'onboarding.wedding.defaultTitle': "{name}'s Wedding",
  'onboarding.wedding.defaultTitleCouple': "{a} & {b}'s Wedding",
} as const
