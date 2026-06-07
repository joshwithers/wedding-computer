export type ParsedData = {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseCSV(text: string): ParsedData {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)

  const records = parseRecords(text)
  if (records.length === 0) return { headers: [], rows: [] }

  const headers = records[0].map((h) => h.trim())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < records.length; i++) {
    const record = records[i]
    if (record.length === 1 && record[0].trim() === '') continue
    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = (record[j] ?? '').trim()
    }
    rows.push(obj)
  }

  return { headers, rows }
}

function parseRecords(text: string): string[][] {
  const records: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        field += ch
        i++
      }
    } else if (ch === '"' && field.length === 0) {
      inQuotes = true
      i++
    } else if (ch === ',') {
      current.push(field)
      field = ''
      i++
    } else if (ch === '\r') {
      current.push(field)
      field = ''
      records.push(current)
      current = []
      i++
      if (i < text.length && text[i] === '\n') i++
    } else if (ch === '\n') {
      current.push(field)
      field = ''
      records.push(current)
      current = []
      i++
    } else {
      field += ch
      i++
    }
  }

  if (field.length > 0 || current.length > 0) {
    current.push(field)
    records.push(current)
  }

  return records
}

export function parseJSON(text: string): ParsedData {
  const parsed = JSON.parse(text)
  const items: Record<string, unknown>[] = Array.isArray(parsed) ? parsed : [parsed]

  if (items.length === 0) return { headers: [], rows: [] }

  const flatItems = items.map((item) => flattenObject(item))
  const headerSet = new Set<string>()
  for (const item of flatItems) {
    for (const key of Object.keys(item)) {
      headerSet.add(key)
    }
  }
  const headers = Array.from(headerSet)

  const rows = flatItems.map((item) => {
    const obj: Record<string, string> = {}
    for (const h of headers) {
      const val = item[h]
      obj[h] = val == null ? '' : String(val)
    }
    return obj
  })

  return { headers, rows }
}

function flattenObject(
  obj: Record<string, unknown>,
  prefix = ''
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value as Record<string, unknown>, fullKey))
    } else if (Array.isArray(value)) {
      result[fullKey] = value.join(', ')
    } else {
      result[fullKey] = value
    }
  }
  return result
}

export function detectDelimiter(text: string): ',' | '\t' | ';' | '|' {
  const firstLine = text.split(/\r?\n/)[0] ?? ''
  const counts = {
    ',': (firstLine.match(/,/g) ?? []).length,
    '\t': (firstLine.match(/\t/g) ?? []).length,
    ';': (firstLine.match(/;/g) ?? []).length,
    '|': (firstLine.match(/\|/g) ?? []).length,
  }
  let best: ',' | '\t' | ';' | '|' = ','
  let max = 0
  for (const [delim, count] of Object.entries(counts)) {
    if (count > max) {
      max = count
      best = delim as ',' | '\t' | ';' | '|'
    }
  }
  return best
}

export function parseTSV(text: string): ParsedData {
  return parseDelimited(text, '\t')
}

function parseDelimited(text: string, delimiter: string): ParsedData {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = lines[0].split(delimiter).map((h) => h.trim())
  const rows = lines.slice(1).map((line) => {
    const values = line.split(delimiter)
    const obj: Record<string, string> = {}
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (values[i] ?? '').trim()
    }
    return obj
  })

  return { headers, rows }
}
