import { PDFDocument, PDFName } from 'pdf-lib'

function val(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return v !== undefined && v !== null && v !== '' ? String(v) : ''
}

function setCheckbox(
  form: ReturnType<PDFDocument['getForm']>,
  fieldName: string,
  value: string
) {
  try {
    const field = form.getCheckBox(fieldName)
    const acro = field.acroField
    const widgets = acro.getWidgets()
    acro.dict.set(PDFName.of('V'), PDFName.of(value))
    widgets.forEach((w) => {
      const onValue = w.getOnValue()
      if (onValue && onValue.decodeText() === value) {
        w.dict.set(PDFName.of('AS'), PDFName.of(value))
      } else {
        w.dict.set(PDFName.of('AS'), PDFName.of('Off'))
      }
    })
  } catch {
    // Field not found — skip
  }
}

function setTextField(
  form: ReturnType<PDFDocument['getForm']>,
  fieldName: string,
  value: string
) {
  try {
    if (value) form.getTextField(fieldName).setText(value)
  } catch {
    // Field not found — skip
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function formatBirthplace(data: Record<string, unknown>, prefix: string): string {
  const country = val(data, `${prefix}_birth_country`)
  const city = val(data, `${prefix}_birth_city`)
  if (country === 'Australia') {
    const state = val(data, `${prefix}_birth_state`)
    return [city, state, 'Australia'].filter(Boolean).join(', ')
  } else {
    const state = val(data, `${prefix}_birth_state_international`)
    return [city, state, country].filter(Boolean).join(', ')
  }
}

function mapDescription(value: string): string {
  switch (value) {
    case 'partner': return 'Partner'
    case 'bride': return 'Bride'
    case 'groom': return 'Groom'
    default: return ''
  }
}

function mapGender(value: string): string {
  switch (value) {
    case 'female': return 'Female'
    case 'male': return 'Male'
    case 'non-binary': return 'Non-binary'
    default: return ''
  }
}

function mapConjugalStatus(value: string): string {
  switch (value) {
    case 'never_married': return 'Never validly married'
    case 'divorced': return 'Divorced'
    case 'widowed': return 'Widowed'
    default: return ''
  }
}

function fillParty(form: ReturnType<PDFDocument['getForm']>, data: Record<string, unknown>, prefix: string, partyNum: '1' | '2') {
  const desc = mapDescription(val(data, `${prefix}_description`))
  if (desc) setCheckbox(form, `Person ${partyNum} Description`, desc)

  setTextField(form, `Person${partyNum}FamilyName`, val(data, `${prefix}_last_name`))
  setTextField(form, `Person${partyNum}GivenName`, [val(data, `${prefix}_first_name`), val(data, `${prefix}_middle_names`)].filter(Boolean).join(' '))
  setTextField(form, `Person${partyNum}UsualOccupation`, val(data, `${prefix}_occupation`))
  setTextField(form, `Person${partyNum}PlaceOfResidence`, val(data, `${prefix}_address`))
  setTextField(form, `Person${partyNum}Birthplace`, formatBirthplace(data, prefix))
  setTextField(form, `Person${partyNum}DateOfBirth`, formatDate(val(data, `${prefix}_dob`)))

  const gender = mapGender(val(data, `${prefix}_gender`))
  if (gender) setCheckbox(form, `Person ${partyNum} Gender`, gender)

  const conjugal = mapConjugalStatus(val(data, `${prefix}_conjugal_status`))
  if (conjugal) setCheckbox(form, `Person${partyNum}ConjugalStatus`, conjugal)

  if (val(data, `${prefix}_conjugal_status`) === 'divorced') {
    setTextField(form, `Person${partyNum}CourtDivorceNullity`, val(data, `${prefix}_divorce_court`))
    setTextField(form, `Person${partyNum}DateMarriageEnded`, formatDate(val(data, `${prefix}_divorce_date`)))
  }
  if (val(data, `${prefix}_conjugal_status`) === 'widowed') {
    setTextField(form, `Person${partyNum}DeathCertificate`, val(data, `${prefix}_death_certificate_number`))
    setTextField(form, `Person${partyNum}DateMarriageEnded`, formatDate(val(data, `${prefix}_spouse_death_date`)))
  }

  // Parents
  const fatherName = [val(data, `${prefix}_father_first_name`), val(data, `${prefix}_father_middle_names`), val(data, `${prefix}_father_last_name`)].filter(Boolean).join(' ')
  setTextField(form, `Person${partyNum}Parent1FullCurrentName`, fatherName)
  if (val(data, `${prefix}_father_name_changed`) === 'yes') {
    const birthName = [val(data, `${prefix}_father_birth_first_name`), val(data, `${prefix}_father_birth_middle_names`), val(data, `${prefix}_father_birth_last_name`)].filter(Boolean).join(' ')
    setTextField(form, `Person${partyNum}Parent1FullBirthName`, birthName)
  } else {
    setTextField(form, `Person${partyNum}Parent1FullBirthName`, fatherName)
  }
  setTextField(form, `Person${partyNum}Parent1CountryofBirth`, val(data, `${prefix}_father_birth_country`))

  const motherName = [val(data, `${prefix}_mother_first_name`), val(data, `${prefix}_mother_middle_names`), val(data, `${prefix}_mother_last_name`)].filter(Boolean).join(' ')
  setTextField(form, `Person${partyNum}Parent2FullCurrentName`, motherName)
  if (val(data, `${prefix}_mother_name_changed`) === 'yes') {
    const birthName = [val(data, `${prefix}_mother_birth_first_name`), val(data, `${prefix}_mother_birth_middle_names`), val(data, `${prefix}_mother_birth_last_name`)].filter(Boolean).join(' ')
    setTextField(form, `Person${partyNum}Parent2FullBirthName`, birthName)
  } else {
    setTextField(form, `Person${partyNum}Parent2FullBirthName`, motherName)
  }
  setTextField(form, `Person${partyNum}Parent2CountryofBirth`, val(data, `${prefix}_mother_birth_country`))
}

export async function generateNoimPdf(
  data: Record<string, unknown>,
  pdfBytes: ArrayBuffer
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  const form = doc.getForm()

  fillParty(form, data, 'p1', '1')
  fillParty(form, data, 'p2', '2')

  // Relationship
  const related = val(data, 'parties_related')
  if (related === 'yes') {
    setCheckbox(form, 'AreThePartiesRelated', 'Yes')
    setTextField(form, 'RelatedPartiesRelationship', val(data, 'relationship_details'))
  } else if (related === 'no') {
    setCheckbox(form, 'AreThePartiesRelated', 'No')
  }

  // Wedding details
  setTextField(form, 'CelebrantLocation', val(data, 'wedding_location'))
  setTextField(form, 'CelebrantTimeAndDate', formatDate(val(data, 'wedding_date')))

  form.flatten()
  return await doc.save()
}

export function buildDocumentChecklist(data: Record<string, unknown>): string[] {
  const docs: string[] = []
  const p1Conjugal = val(data, 'p1_conjugal_status')
  const p2Conjugal = val(data, 'p2_conjugal_status')
  const p1Country = val(data, 'p1_birth_country')
  const p2Country = val(data, 'p2_birth_country')

  if (p1Country === 'Australia') {
    docs.push('Official birth certificate (Party 1) — Australian')
  } else {
    docs.push(`Official birth certificate (Party 1) — from ${p1Country || 'country of birth'}`)
  }
  if (p2Country === 'Australia') {
    docs.push('Official birth certificate (Party 2) — Australian')
  } else {
    docs.push(`Official birth certificate (Party 2) — from ${p2Country || 'country of birth'}`)
  }

  docs.push('Government-issued photo ID for each party (passport, driver licence)')

  if (p1Conjugal === 'divorced') docs.push('Divorce order/decree absolute (Party 1)')
  if (p2Conjugal === 'divorced') docs.push('Divorce order/decree absolute (Party 2)')
  if (p1Conjugal === 'widowed') docs.push('Death certificate of former spouse (Party 1)')
  if (p2Conjugal === 'widowed') docs.push('Death certificate of former spouse (Party 2)')
  if (p1Country !== 'Australia') docs.push('Certified translation of any non-English documents (Party 1)')
  if (p2Country !== 'Australia') docs.push('Certified translation of any non-English documents (Party 2)')

  return docs
}
