import { buildDocumentChecklist } from './pdf-generator'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function val(data: Record<string, unknown>, key: string): string {
  const v = data[key]
  return v !== undefined && v !== null && v !== '' ? String(v) : ''
}

function givenNames(data: Record<string, unknown>, prefix: string): string {
  return [val(data, `${prefix}_first_name`), val(data, `${prefix}_middle_names`)].filter(Boolean).join(' ')
}

function fullName(data: Record<string, unknown>, prefix: string): string {
  return [val(data, `${prefix}_first_name`), val(data, `${prefix}_middle_names`), val(data, `${prefix}_last_name`)].filter(Boolean).join(' ')
}

function formatConjugalStatus(value: string): string {
  switch (value) {
    case 'never_married': return 'Never validly married'
    case 'divorced': return 'Divorced'
    case 'widowed': return 'Widowed'
    default: return value
  }
}

function formatDescription(value: string): string {
  switch (value) {
    case 'partner': return 'Partner'
    case 'bride': return 'Bride'
    case 'groom': return 'Groom'
    default: return value
  }
}

function formatGender(value: string): string {
  switch (value) {
    case 'female': return 'Female'
    case 'male': return 'Male'
    case 'x': return 'X'
    case 'non-binary': return 'X' // legacy rows saved before the Sex/X label change
    default: return 'Not specified'
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

type Row = { item: string; label: string; value: string }

function buildPartyRows(data: Record<string, unknown>, prefix: string): Row[] {
  const rows: Row[] = []
  const conjugal = val(data, `${prefix}_conjugal_status`)

  rows.push({ item: '1', label: 'Description', value: formatDescription(val(data, `${prefix}_description`)) })
  rows.push({ item: '2', label: 'Surname/family name', value: val(data, `${prefix}_last_name`) })
  rows.push({ item: '3', label: 'Given name(s)', value: givenNames(data, prefix) })
  rows.push({ item: '4', label: 'Sex', value: formatGender(val(data, `${prefix}_gender`)) })
  rows.push({ item: '5', label: 'Usual occupation', value: val(data, `${prefix}_occupation`) })
  rows.push({ item: '6', label: 'Usual place of residence', value: val(data, `${prefix}_address`) })
  rows.push({ item: '7', label: 'Conjugal status', value: formatConjugalStatus(conjugal) })

  if (conjugal === 'divorced') {
    rows.push({ item: '7a', label: 'Date divorce became final', value: formatDate(val(data, `${prefix}_divorce_date`)) })
    rows.push({ item: '7b', label: 'Court that granted divorce', value: val(data, `${prefix}_divorce_court`) })
  }
  if (conjugal === 'widowed') {
    rows.push({ item: '7a', label: 'Death certificate number', value: val(data, `${prefix}_death_certificate_number`) })
    rows.push({ item: '7b', label: 'Date of death', value: formatDate(val(data, `${prefix}_spouse_death_date`)) })
  }

  rows.push({ item: '8', label: 'Birthplace', value: formatBirthplace(data, prefix) })
  rows.push({ item: '9', label: 'Date of birth', value: formatDate(val(data, `${prefix}_dob`)) })
  return rows
}

function buildParentRows(data: Record<string, unknown>, prefix: string): Row[] {
  const rows: Row[] = []

  for (const [parentPrefix, parentLabel, givenItem, surnameItem, countryItem] of [
    ['father', 'Father/Parent 1', '11', '12', '15'],
    ['mother', 'Mother/Parent 2', '13', '14', '16'],
  ] as const) {
    const fullPre = `${prefix}_${parentPrefix}`
    const changed = val(data, `${fullPre}_name_changed`)
    const birthName = changed === 'yes'
      ? [val(data, `${fullPre}_birth_first_name`), val(data, `${fullPre}_birth_middle_names`), val(data, `${fullPre}_birth_last_name`)].filter(Boolean).join(' ')
      : ''
    const country = val(data, `${fullPre}_birth_country`)

    rows.push({ item: givenItem, label: `${parentLabel}'s given name(s)`, value: givenNames(data, fullPre) || 'Not provided' })
    let surnameVal = val(data, `${fullPre}_last_name`) || 'Not provided'
    if (birthName) surnameVal += ` (born: ${birthName})`
    rows.push({ item: surnameItem, label: `${parentLabel}'s surname`, value: surnameVal })
    rows.push({ item: countryItem, label: `${parentLabel}'s country of birth`, value: country || 'Not provided' })
  }

  return rows
}

function renderRows(rows: Row[]): string {
  return rows
    .map(
      (r) =>
        `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;white-space:nowrap;vertical-align:top;font-size:13px">${escapeHtml(r.item)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151;white-space:nowrap;vertical-align:top">${escapeHtml(r.label)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;color:#1f2937">${escapeHtml(r.value)}</td>
        </tr>`
    )
    .join('')
}

function renderSection(title: string, rows: Row[]): string {
  return `
    <tr><td colspan="3" style="padding:16px 12px 8px;font-weight:700;font-size:15px;color:#1f2937;border-bottom:2px solid #e5e7eb">${escapeHtml(title)}</td></tr>
    ${renderRows(rows)}
  `
}

export function renderNoimEmail(data: Record<string, unknown>, businessName?: string): string {
  const p1Name = `${val(data, 'p1_first_name')} ${val(data, 'p1_last_name')}`.trim()
  const p2Name = `${val(data, 'p2_first_name')} ${val(data, 'p2_last_name')}`.trim()

  const party1Rows = buildPartyRows(data, 'p1')
  const party1Parents = buildParentRows(data, 'p1')
  const party2Rows = buildPartyRows(data, 'p2')
  const party2Parents = buildParentRows(data, 'p2')

  const weddingRows: Row[] = [
    { item: '', label: 'Wedding location', value: val(data, 'wedding_location') },
    { item: '', label: 'Wedding date', value: formatDate(val(data, 'wedding_date')) },
  ]
  const isInternational = val(data, 'is_international')
  weddingRows.push({ item: '', label: 'International wedding?', value: isInternational === 'yes' ? 'Yes' : 'No' })
  if (isInternational === 'yes') {
    weddingRows.push({ item: '', label: 'International ceremony date', value: formatDate(val(data, 'international_date')) })
    const hasAuDate = val(data, 'has_australian_date')
    weddingRows.push({ item: '', label: 'Australian paperwork date organised?', value: hasAuDate === 'yes' ? 'Yes' : 'No' })
    if (hasAuDate === 'yes') {
      weddingRows.push({ item: '', label: 'Australian paperwork date', value: formatDate(val(data, 'australian_paperwork_date')) })
    }
  }

  const related = val(data, 'parties_related')
  const relationshipDetails = val(data, 'relationship_details')

  const documents: string[] = buildDocumentChecklist(data)
  const documentListHtml = documents
    .map((d: string) => `<li style="padding:4px 0;color:#374151">${escapeHtml(d)}</li>`)
    .join('')

  const fromLabel = businessName || 'Wedding Computer'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:20px;background:#f9fafb">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="padding:24px;background:#1f2937;color:#fff">
      <h1 style="margin:0;font-size:18px">Notice of Intended Marriage</h1>
      <p style="margin:8px 0 0;font-size:14px;color:#d1d5db">${escapeHtml(p1Name)} &amp; ${escapeHtml(p2Name)}</p>
    </div>

    <div style="padding:24px">
      <p style="color:#6b7280;font-size:13px;margin:0 0 16px">
        This email contains the NOIM submission data organised by official item numbers.
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:14px">
        ${renderSection('Party 1 — Personal Details', party1Rows)}
        ${renderSection('Party 1 — Parent Details', party1Parents)}
        ${renderSection('Party 2 — Personal Details', party2Rows)}
        ${renderSection('Party 2 — Parent Details', party2Parents)}

        <tr><td colspan="3" style="padding:16px 12px 8px;font-weight:700;font-size:15px;color:#1f2937;border-bottom:2px solid #e5e7eb">Relationship (Item 10)</td></tr>
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;white-space:nowrap;vertical-align:top;font-size:13px">10</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151;white-space:nowrap;vertical-align:top">Are parties related?</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;color:#1f2937">${escapeHtml(related === 'yes' ? 'Yes' : 'No')}</td>
        </tr>
        ${related === 'yes' ? `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;white-space:nowrap;vertical-align:top;font-size:13px">10a</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151;white-space:nowrap;vertical-align:top">Relationship details</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;color:#1f2937">${escapeHtml(relationshipDetails)}</td>
        </tr>` : ''}

        ${renderSection('Wedding / Ceremony', weddingRows)}
      </table>

      <div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb">
        <h3 style="margin:0 0 12px;font-size:15px;color:#1f2937">Document Checklist</h3>
        <ul style="margin:0;padding-left:20px;font-size:14px">
          ${documentListHtml}
        </ul>
      </div>
    </div>

    <div style="padding:16px 24px;background:#f9fafb;color:#9ca3af;font-size:12px;text-align:center">
      Submitted via ${escapeHtml(fromLabel)}
    </div>
  </div>
</body>
</html>`
}

export function getNoimEmailSubject(data: Record<string, unknown>): string {
  const p1Name = `${val(data, 'p1_first_name')} ${val(data, 'p1_last_name')}`.trim()
  const p2Name = `${val(data, 'p2_first_name')} ${val(data, 'p2_last_name')}`.trim()
  return `NOIM Submission: ${p1Name} & ${p2Name}`
}

export function renderCoupleConfirmationEmail(data: Record<string, unknown>, businessName?: string): string {
  const p1Name = `${val(data, 'p1_first_name')} ${val(data, 'p1_last_name')}`.trim()
  const p2Name = `${val(data, 'p2_first_name')} ${val(data, 'p2_last_name')}`.trim()
  const weddingDate = formatDate(val(data, 'wedding_date'))
  const weddingLocation = val(data, 'wedding_location')
  const fromLabel = businessName || 'Wedding Computer'

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:20px;background:#f9fafb">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
    <div style="padding:24px;background:#1f2937;color:#fff">
      <h1 style="margin:0;font-size:18px">Your NOIM is ready</h1>
      <p style="margin:8px 0 0;font-size:14px;color:#d1d5db">${escapeHtml(p1Name)} &amp; ${escapeHtml(p2Name)}</p>
    </div>

    <div style="padding:24px">
      <p style="font-size:15px;color:#1f2937;line-height:1.6;margin:0 0 16px">
        Your completed Notice of Intended Marriage (NOIM) PDF is attached to this email. Here's a summary:
      </p>

      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px">
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151">Party 1</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#1f2937">${escapeHtml(p1Name)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151">Party 2</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#1f2937">${escapeHtml(p2Name)}</td>
        </tr>
        ${weddingDate ? `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151">Wedding date</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#1f2937">${escapeHtml(weddingDate)}</td>
        </tr>` : ''}
        ${weddingLocation ? `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#374151">Location</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#1f2937">${escapeHtml(weddingLocation)}</td>
        </tr>` : ''}
      </table>

      <p style="font-size:14px;color:#6b7280;line-height:1.5;margin:0">
        Print the PDF and bring it to your meeting with your celebrant, along with your original identity documents.
      </p>
    </div>

    <div style="padding:16px 24px;background:#f9fafb;color:#9ca3af;font-size:12px;text-align:center">
      ${escapeHtml(fromLabel)}
    </div>
  </div>
</body>
</html>`
}
