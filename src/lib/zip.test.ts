import { describe, expect, it } from 'vitest'
import { createZip, safeZipPath } from './zip'

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
}

function centralDirectoryNames(zip: Uint8Array): string[] {
  const decoder = new TextDecoder()
  const eocd = zip.length - 22
  expect(u32(zip, eocd)).toBe(0x06054b50)
  const count = u16(zip, eocd + 10)
  let offset = u32(zip, eocd + 16)
  const names: string[] = []

  for (let i = 0; i < count; i++) {
    expect(u32(zip, offset)).toBe(0x02014b50)
    const nameLength = u16(zip, offset + 28)
    const extraLength = u16(zip, offset + 30)
    const commentLength = u16(zip, offset + 32)
    names.push(decoder.decode(zip.slice(offset + 46, offset + 46 + nameLength)))
    offset += 46 + nameLength + extraLength + commentLength
  }

  return names
}

describe('safeZipPath', () => {
  it('removes traversal and unsafe filename characters', () => {
    expect(safeZipPath('../bad/..//evil<name>.txt')).toBe('bad/evilname.txt')
    expect(safeZipPath('')).toBe('file')
  })
})

describe('createZip', () => {
  it('writes a valid central directory with sanitized paths', () => {
    const zip = createZip([
      { path: '../exports/unsafe<name>.txt', data: 'hello' },
      { path: 'nested/file.json', data: '{"ok":true}' },
    ])

    expect(u32(zip, 0)).toBe(0x04034b50)
    expect(centralDirectoryNames(zip)).toEqual(['exports/unsafename.txt', 'nested/file.json'])
  })
})
