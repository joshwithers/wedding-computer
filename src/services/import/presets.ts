export type ColumnMapping = Record<string, string>

export type ImportPreset = {
  name: string
  description: string
  defaultMapping: ColumnMapping
  notes: string
}

export const CONTACT_TARGET_FIELDS = [
  { key: 'first_name', label: 'First name', required: true },
  { key: 'last_name', label: 'Last name', required: true },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'partner_first_name', label: 'Partner first name' },
  { key: 'partner_last_name', label: 'Partner last name' },
  { key: 'partner_email', label: 'Partner email' },
  { key: 'partner_phone', label: 'Partner phone' },
  { key: 'wedding_date', label: 'Wedding date' },
  { key: 'wedding_location', label: 'Wedding location' },
  { key: 'source', label: 'Source' },
  { key: 'status', label: 'Status' },
  { key: 'notes', label: 'Notes' },
  { key: '_skip', label: '-- Skip this column --' },
] as const

export const IMPORT_PRESETS: Record<string, ImportPreset> = {
  dubsado: {
    name: 'Dubsado',
    description: 'Import projects and clients exported from Dubsado as CSV.',
    defaultMapping: {
      'First Name': 'first_name',
      'Last Name': 'last_name',
      'Client Name': 'first_name',
      'Email': 'email',
      'Phone': 'phone',
      'Phone Number': 'phone',
      'Partner First Name': 'partner_first_name',
      'Partner Last Name': 'partner_last_name',
      'Partner Email': 'partner_email',
      'Status': 'status',
      'Lead or Job': 'status',
      'Event Date': 'wedding_date',
      'Wedding Date': 'wedding_date',
      'Event Location': 'wedding_location',
      'Location': 'wedding_location',
      'Notes': 'notes',
      'Source': 'source',
      'Lead Source': 'source',
      'Tags': '_skip',
      'Contract Status': '_skip',
      'Archived': '_skip',
      'Primary Invoice Amount': '_skip',
      'Total Amount Paid': '_skip',
      'Team': '_skip',
    },
    notes: 'Export from Dubsado: Settings → Data Export → filter by status → Download CSV. Projects and clients export together. Custom field columns will use fuzzy matching.',
  },
  studio_ninja: {
    name: 'Studio Ninja',
    description: 'Import your client list exported from Studio Ninja as CSV.',
    defaultMapping: {
      'First Name': 'first_name',
      'Last Name': 'last_name',
      'Email': 'email',
      'Phone': 'phone',
      'Company Name': '_skip',
      'Business Number': '_skip',
      'Street Address': '_skip',
      'Suburb/Town': 'wedding_location',
      'Postcode/Zip': '_skip',
      'State': '_skip',
      'Country': '_skip',
      'Date Added': '_skip',
      'Total number of open Leads': '_skip',
      'Total number of archived Leads': '_skip',
      'Total number of active Jobs': '_skip',
      'Total number of completed Jobs': '_skip',
      'Consent from Contact Form': '_skip',
      'Consent from Contract': '_skip',
      'Consent from Questionnaire': '_skip',
      'Consent added by me': '_skip',
      'Client Notes': 'notes',
    },
    notes: 'Export from Studio Ninja: Clients → Export Client List → downloads a CSV. Note: this exports your client list only. For leads and jobs, use Leads/Jobs → Export which emails a ZIP file — extract the CSV and import here.',
  },
  honeybook: {
    name: 'HoneyBook',
    description: 'Import contacts exported from HoneyBook as CSV.',
    defaultMapping: {
      'Client Name': 'first_name',
      'Client First Name': 'first_name',
      'Client Last Name': 'last_name',
      'First Name': 'first_name',
      'Last Name': 'last_name',
      'Name': 'first_name',
      'Email': 'email',
      'Client Email': 'email',
      'Phone': 'phone',
      'Phone Number': 'phone',
      'Address': '_skip',
      'Project Name': '_skip',
      'Project Date': 'wedding_date',
      'Event Date': 'wedding_date',
      'Date Created': '_skip',
      'Status': 'status',
      'Pipeline Status': 'status',
      'Notes': 'notes',
      'Source': 'source',
    },
    notes: 'Export from HoneyBook: Clients → Contacts tab → ⋯ menu → Download spreadsheet. Exports contacts only — project and booking details are not included. Column names may vary by account configuration.',
  },
  vsco_workspace: {
    name: 'VSCO Workspace',
    description: 'Import leads, jobs, or contacts exported from VSCO Workspace (formerly Táve).',
    defaultMapping: {
      'First': 'first_name',
      'Last': 'last_name',
      'First Name': 'first_name',
      'Last Name': 'last_name',
      'Email': 'email',
      'Client Emails': 'email',
      'Phone': 'phone',
      'Mobile': 'phone',
      'Partner First': 'partner_first_name',
      'Partner Last': 'partner_last_name',
      'Partner Email': 'partner_email',
      'Event Date': 'wedding_date',
      'Event Location': 'wedding_location',
      'Venue': 'wedding_location',
      'Type': '_skip',
      'Status': 'status',
      'Source': 'source',
      'Referral': 'source',
      'Notes': 'notes',
    },
    notes: 'Export from VSCO Workspace: open any list (Leads, Jobs, or Address Book) → Export → choose "all columns" for best results. Column names depend on your visible columns configuration. Formerly known as Táve.',
  },
  tardis: {
    name: 'Tardis',
    description: 'Import contacts from a Tardis (Cloudflare Workers CRM) export.',
    defaultMapping: {
      'first_name': 'first_name',
      'last_name': 'last_name',
      'email': 'email',
      'phone': 'phone',
      'partner_first_name': 'partner_first_name',
      'partner_last_name': 'partner_last_name',
      'partner_email': 'partner_email',
      'partner_phone': 'partner_phone',
      'wedding_date': 'wedding_date',
      'wedding_location': 'wedding_location',
      'source': 'source',
      'status': 'status',
      'notes': 'notes',
    },
    notes: 'Export from Tardis: Settings → Export Data → Contacts → JSON or CSV.',
  },
}

export function autoMapColumns(
  sourceHeaders: string[],
  presetSource?: string
): ColumnMapping {
  const mapping: ColumnMapping = {}
  const preset = presetSource ? IMPORT_PRESETS[presetSource] : null

  for (const header of sourceHeaders) {
    if (preset?.defaultMapping[header]) {
      mapping[header] = preset.defaultMapping[header]
      continue
    }

    const match = fuzzyMatchField(header)
    mapping[header] = match ?? '_skip'
  }

  return mapping
}

function fuzzyMatchField(header: string): string | null {
  const h = header.toLowerCase().replace(/[^a-z0-9]/g, '')

  const exactMatches: Record<string, string> = {
    firstname: 'first_name',
    first: 'first_name',
    fname: 'first_name',
    lastname: 'last_name',
    last: 'last_name',
    lname: 'last_name',
    surname: 'last_name',
    email: 'email',
    emailaddress: 'email',
    phone: 'phone',
    phonenumber: 'phone',
    mobile: 'phone',
    cell: 'phone',
    telephone: 'phone',
    partnerfirstname: 'partner_first_name',
    partnerfirst: 'partner_first_name',
    partnername: 'partner_first_name',
    spouse: 'partner_first_name',
    partnerlastname: 'partner_last_name',
    partnerlast: 'partner_last_name',
    partneremail: 'partner_email',
    partnerphone: 'partner_phone',
    weddingdate: 'wedding_date',
    eventdate: 'wedding_date',
    date: 'wedding_date',
    shootdate: 'wedding_date',
    projectdate: 'wedding_date',
    weddinglocation: 'wedding_location',
    eventlocation: 'wedding_location',
    location: 'wedding_location',
    venue: 'wedding_location',
    source: 'source',
    leadsource: 'source',
    referral: 'source',
    referralsource: 'source',
    howyoufoundus: 'source',
    howdidyouhearaboutus: 'source',
    status: 'status',
    pipelinestatus: 'status',
    stage: 'status',
    notes: 'notes',
    internalnotes: 'notes',
    comments: 'notes',
    description: 'notes',
  }

  return exactMatches[h] ?? null
}

const VALID_STATUSES = new Set([
  'new', 'contacted', 'meeting', 'quoted', 'booked', 'completed', 'lost', 'archived',
])

export function normalizeStatus(raw: string): string {
  const s = raw.toLowerCase().trim()
  if (VALID_STATUSES.has(s)) return s

  const statusMap: Record<string, string> = {
    lead: 'new',
    inquiry: 'new',
    enquiry: 'new',
    prospect: 'new',
    pending: 'new',
    'follow up': 'contacted',
    'followed up': 'contacted',
    responded: 'contacted',
    replied: 'contacted',
    'in progress': 'meeting',
    consultation: 'meeting',
    proposal: 'quoted',
    'proposal sent': 'quoted',
    quote: 'quoted',
    'quote sent': 'quoted',
    confirmed: 'booked',
    hired: 'booked',
    active: 'booked',
    won: 'booked',
    closed: 'completed',
    done: 'completed',
    finished: 'completed',
    delivered: 'completed',
    declined: 'lost',
    rejected: 'lost',
    'not booked': 'lost',
    cancelled: 'lost',
    canceled: 'lost',
    inactive: 'archived',
    old: 'archived',
  }

  return statusMap[s] ?? 'new'
}
