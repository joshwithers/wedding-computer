import type { FormStep, FormConfig, FormAction } from '../../lib/form-schema'

const AU_STATES = [
  { value: 'NSW', label: 'New South Wales' },
  { value: 'VIC', label: 'Victoria' },
  { value: 'QLD', label: 'Queensland' },
  { value: 'WA', label: 'Western Australia' },
  { value: 'SA', label: 'South Australia' },
  { value: 'TAS', label: 'Tasmania' },
  { value: 'ACT', label: 'Australian Capital Territory' },
  { value: 'NT', label: 'Northern Territory' },
]

const DESCRIPTION_OPTIONS = [
  { value: 'partner', label: 'Partner' },
  { value: 'bride', label: 'Bride' },
  { value: 'groom', label: 'Groom' },
]

const GENDER_OPTIONS = [
  { value: '', label: 'Prefer not to say' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non-binary', label: 'Non-binary' },
]

const CONJUGAL_STATUS_OPTIONS = [
  { value: 'never_married', label: 'Never validly married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
]

function partyFields(prefix: string, partyLabel: string): FormStep['fields'] {
  return [
    {
      id: `${prefix}_description`,
      label: `How would ${partyLabel} like to be described?`,
      type: 'select',
      required: true,
      options: DESCRIPTION_OPTIONS,
    },
    {
      id: `${prefix}_last_name`,
      label: 'Last name (surname)',
      type: 'text',
      required: true,
      titleCase: true,
      helpText: 'As it appears on your identification documents',
    },
    {
      id: `${prefix}_first_name`,
      label: 'First name',
      type: 'text',
      required: true,
      titleCase: true,
    },
    {
      id: `${prefix}_middle_names`,
      label: 'Middle name(s)',
      type: 'text',
      required: false,
      titleCase: true,
      helpText: 'Leave blank if no middle name',
    },
    {
      id: `${prefix}_gender`,
      label: 'Gender',
      type: 'select',
      required: false,
      options: GENDER_OPTIONS,
      helpText: 'Optional — you may leave this blank',
    },
    {
      id: `${prefix}_occupation`,
      label: 'Usual occupation',
      type: 'text',
      required: true,
      titleCase: true,
      placeholder: 'e.g. Marketing Manager',
    },
    {
      id: `${prefix}_address`,
      label: 'Usual place of residence',
      type: 'address',
      required: true,
      helpText: 'Start typing and select from the suggestions',
    },
    {
      id: `${prefix}_conjugal_status`,
      label: 'Conjugal status',
      type: 'select',
      required: true,
      options: CONJUGAL_STATUS_OPTIONS,
    },
    {
      id: `${prefix}_divorce_date`,
      label: 'Date divorce became final',
      type: 'date',
      required: true,
      conditions: [{ field: `${prefix}_conjugal_status`, operator: 'eq', value: 'divorced' }],
    },
    {
      id: `${prefix}_divorce_court`,
      label: 'Court that granted the divorce',
      type: 'text',
      required: true,
      titleCase: true,
      placeholder: 'e.g. Family Court of Australia, Sydney',
      conditions: [{ field: `${prefix}_conjugal_status`, operator: 'eq', value: 'divorced' }],
    },
    {
      id: `${prefix}_death_certificate_number`,
      label: 'Death certificate number',
      type: 'text',
      required: true,
      conditions: [{ field: `${prefix}_conjugal_status`, operator: 'eq', value: 'widowed' }],
    },
    {
      id: `${prefix}_spouse_death_date`,
      label: 'Date of death',
      type: 'date',
      required: true,
      conditions: [{ field: `${prefix}_conjugal_status`, operator: 'eq', value: 'widowed' }],
    },
    {
      id: `${prefix}_birth_country`,
      label: 'Country of birth',
      type: 'country',
      required: true,
    },
    {
      id: `${prefix}_birth_city`,
      label: 'City/town of birth',
      type: 'text',
      required: true,
      titleCase: true,
    },
    {
      id: `${prefix}_birth_state`,
      label: 'State/territory of birth',
      type: 'select',
      required: true,
      options: AU_STATES,
      conditions: [{ field: `${prefix}_birth_country`, operator: 'eq', value: 'Australia' }],
    },
    {
      id: `${prefix}_birth_state_international`,
      label: 'State/province of birth',
      type: 'text',
      required: false,
      conditions: [{ field: `${prefix}_birth_country`, operator: 'neq', value: 'Australia' }],
    },
    {
      id: `${prefix}_dob`,
      label: 'Date of birth',
      type: 'date',
      required: true,
    },
  ]
}

function singleParentFields(prefix: string, parentPrefix: string, parentLabel: string): FormStep['fields'] {
  return [
    {
      id: `${prefix}_${parentPrefix}_first_name`,
      label: `${parentLabel}'s first name`,
      type: 'text',
      required: false,
      titleCase: true,
      helpText: 'Leave blank if unknown',
    },
    {
      id: `${prefix}_${parentPrefix}_middle_names`,
      label: `${parentLabel}'s middle name(s)`,
      type: 'text',
      required: false,
      titleCase: true,
    },
    {
      id: `${prefix}_${parentPrefix}_last_name`,
      label: `${parentLabel}'s last name (surname)`,
      type: 'text',
      required: false,
      titleCase: true,
    },
    {
      id: `${prefix}_${parentPrefix}_name_changed`,
      label: "Has this parent's name changed since their birth?",
      type: 'radio',
      required: false,
      options: [
        { value: 'no', label: 'No' },
        { value: 'yes', label: 'Yes' },
      ],
    },
    {
      id: `${prefix}_${parentPrefix}_birth_first_name`,
      label: `${parentLabel}'s first name at birth`,
      type: 'text',
      required: true,
      titleCase: true,
      conditions: [{ field: `${prefix}_${parentPrefix}_name_changed`, operator: 'eq', value: 'yes' }],
    },
    {
      id: `${prefix}_${parentPrefix}_birth_middle_names`,
      label: `${parentLabel}'s middle name(s) at birth`,
      type: 'text',
      required: false,
      titleCase: true,
      conditions: [{ field: `${prefix}_${parentPrefix}_name_changed`, operator: 'eq', value: 'yes' }],
    },
    {
      id: `${prefix}_${parentPrefix}_birth_last_name`,
      label: `${parentLabel}'s last name at birth`,
      type: 'text',
      required: true,
      titleCase: true,
      conditions: [{ field: `${prefix}_${parentPrefix}_name_changed`, operator: 'eq', value: 'yes' }],
    },
    {
      id: `${prefix}_${parentPrefix}_birth_country`,
      label: `${parentLabel}'s country of birth`,
      type: 'country',
      required: false,
    },
  ]
}

export const noimSteps: FormStep[] = [
  {
    id: 'party1-personal',
    title: 'Party 1 — Personal Details',
    description: 'Items 1–9 from the NOIM for the first party',
    fields: partyFields('p1', 'Party 1'),
  },
  {
    id: 'party1-parents',
    title: 'Party 1 — Parent Details',
    description: 'Items 11–16 from the NOIM (optional but helpful for the marriage register)',
    fields: [
      ...singleParentFields('p1', 'father', 'Father / Parent 1'),
      ...singleParentFields('p1', 'mother', 'Mother / Parent 2'),
    ],
  },
  {
    id: 'party2-personal',
    title: 'Party 2 — Personal Details',
    description: 'Items 1–9 from the NOIM for the second party',
    fields: partyFields('p2', 'Party 2'),
  },
  {
    id: 'party2-parents',
    title: 'Party 2 — Parent Details',
    description: 'Items 11–16 from the NOIM (optional but helpful for the marriage register)',
    fields: [
      ...singleParentFields('p2', 'father', 'Father / Parent 1'),
      ...singleParentFields('p2', 'mother', 'Mother / Parent 2'),
    ],
  },
  {
    id: 'relationship',
    title: 'Relationship & Ceremony Details',
    description: 'Item 10 and wedding/ceremony information',
    fields: [
      {
        id: 'parties_related',
        label: 'Are the parties related to each other?',
        type: 'radio',
        required: true,
        options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ],
      },
      {
        id: 'relationship_details',
        label: 'If yes, describe the relationship',
        type: 'text',
        required: true,
        helpText: 'Note: marriage between certain close relatives is prohibited under the Marriage Act',
        conditions: [{ field: 'parties_related', operator: 'eq', value: 'yes' }],
      },
      {
        id: 'wedding_location',
        label: 'Wedding/ceremony location',
        type: 'address',
        required: true,
        helpText: 'Start typing the venue or location name',
      },
      {
        id: 'wedding_date',
        label: 'Wedding/ceremony date',
        type: 'date',
        required: true,
      },
      {
        id: 'is_international',
        label: 'Is this an international wedding or elopement?',
        type: 'radio',
        required: true,
        options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ],
      },
      {
        id: 'international_date',
        label: 'International ceremony date',
        type: 'date',
        required: true,
        conditions: [{ field: 'is_international', operator: 'eq', value: 'yes' }],
      },
      {
        id: 'has_australian_date',
        label: 'Have we organised an Australian date for paperwork?',
        type: 'radio',
        required: true,
        options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' },
        ],
        conditions: [{ field: 'is_international', operator: 'eq', value: 'yes' }],
      },
      {
        id: 'australian_paperwork_date',
        label: 'Australian paperwork date',
        type: 'date',
        required: true,
        conditions: [{ field: 'has_australian_date', operator: 'eq', value: 'yes' }],
      },
    ],
  },
  {
    id: 'documents',
    title: 'Document Checklist',
    description: 'Based on your answers, here are the documents you will need to bring to your celebrant.',
    fields: [],
  },
  {
    id: 'review',
    title: 'Review & Submit',
    description: 'Please review all your details before submitting',
    fields: [
      {
        id: 'celebrant_email',
        label: 'Send a copy to your celebrant or another person',
        type: 'email',
        required: false,
        helpText: 'Optional — enter an email address to send the completed NOIM PDF to',
      },
      {
        id: 'couple_email',
        label: 'Send a copy to yourselves',
        type: 'email',
        required: false,
        helpText: 'Optional — enter your email to receive a copy of the PDF',
      },
    ],
  },
]

export function noimFormConfig(): FormConfig {
  const allFields = noimSteps.flatMap((s) => s.fields)
  return {
    version: 1,
    title: 'Notice of Intended Marriage',
    subtitle: 'Complete this form to prepare your NOIM for your celebrant. No data is stored — the form generates a PDF for you to print and sign.',
    submitLabel: 'Generate NOIM PDF',
    fields: allFields,
    steps: noimSteps,
    actions: {
      notifyVendor: true,
      confirmationEmail: { enabled: false, mode: 'template' },
      actions: [
        { type: 'generate_pdf', enabled: true },
        { type: 'email_recipient', enabled: true, emailField: 'celebrant_email' },
        { type: 'email_submitter', enabled: true, emailField: 'couple_email' },
      ],
    },
  }
}
