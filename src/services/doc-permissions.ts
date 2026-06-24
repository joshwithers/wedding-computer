// One permission rule for the scoped wedding docs, applied at every write
// door (vendor web route, couple web route, vault PUT ingest).
// Mirrors the "one rule, all doors" shape of timeline-edit.ts.
//
// Scopes:
//   • shared  — visible to all vendors + the couple. Any vendor on the wedding
//               can edit it (it's the team's shared note); the couple reads it
//               but edits their own 'couple' note instead.
//   • vendors — vendors only; the couple can neither read nor write.
//   • couple  — the couple only (both partners); vendors can neither read nor
//               write.
//   • private — one vendor's own note, for their eyes only (backed by
//               wedding_members.vendor_notes / notes.md). "Solo": no other
//               participant, so presence/soft-lock is skipped.

export type DocScope = 'shared' | 'vendors' | 'couple' | 'private'

export const DOC_SCOPES: readonly DocScope[] = ['shared', 'vendors', 'couple', 'private'] as const

export function isDocScope(value: unknown): value is DocScope {
  return value === 'shared' || value === 'vendors' || value === 'couple' || value === 'private'
}

/** A scope only the viewer can ever access — skip presence + soft-lock. */
export function isSoloScope(scope: DocScope): boolean {
  return scope === 'private'
}

/** Minimal membership shape the gate needs (WeddingMember satisfies it). */
export type DocMembership = {
  role: 'vendor' | 'couple' | 'guest' | string
  can_manage: number
}

export function canReadDoc(member: DocMembership, scope: DocScope): boolean {
  switch (scope) {
    case 'shared':
      return true // any active member of the wedding
    case 'vendors':
      return member.role === 'vendor'
    case 'couple':
      return member.role === 'couple'
    case 'private':
      return member.role === 'vendor' // each vendor sees only their own
  }
}

export function canWriteDoc(member: DocMembership, scope: DocScope): boolean {
  switch (scope) {
    case 'shared':
      return member.role === 'vendor' // any vendor on the wedding (couple is read-only)
    case 'vendors':
      return member.role === 'vendor'
    case 'couple':
      return member.role === 'couple'
    case 'private':
      return member.role === 'vendor'
  }
}

/** Scopes this member may see, in display order. */
export function readableScopes(member: DocMembership): DocScope[] {
  return DOC_SCOPES.filter((s) => canReadDoc(member, s))
}

const SCOPE_LABEL_KEY: Record<DocScope, string> = {
  shared: 'docs.tab.everyone',
  vendors: 'docs.tab.vendors',
  couple: 'docs.tab.couple',
  private: 'docs.tab.private',
}

/** i18n key for a scope's tab label. */
export function scopeLabelKey(scope: DocScope): string {
  return SCOPE_LABEL_KEY[scope]
}
