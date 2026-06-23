// Shared policy for binary uploads accepted from the public (form file fields).
// Mirrors the wedding-documents allowlist so couples can attach the usual
// images, documents, and archives. Validation runs server-side on submission.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 // 10 MB

export const ALLOWED_UPLOAD_TYPES = new Set<string>([
  // Images. SVG is allowed, but authenticated downloads force attachment with
  // nosniff so it cannot execute on the Wedding Computer origin.
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  'text/plain',
  'text/csv',
  'text/markdown',
  // Archives
  'application/zip',
])

export function isAllowedUpload(file: File): boolean {
  return file.size > 0 && file.size <= MAX_UPLOAD_BYTES && ALLOWED_UPLOAD_TYPES.has(file.type)
}

// A safe, short file extension for an R2 key (the original name is kept in the
// DB row + R2 custom metadata; this is only for the key suffix).
export function uploadExt(name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12)
  return ext || 'bin'
}
