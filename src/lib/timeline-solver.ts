// Liquid timeline solver — pure, deterministic.
//
// Each item resolves a clock time from ONE parent:
//   • absolute  — its own start_time (a fixed point)
//   • sun       — a sun event (sunrise/sunset/golden_hour) + offset
//   • after X   — X's END + offset
//   • before X  — ends `offset` before X's START (start = X.start − offset − duration)
// duration gives the end (end = start + duration). The graph is a DAG; cycles
// and missing/unresolvable references are reported as conflicts, never thrown.
//
// In live mode (useActual), an item's actual_start overrides its computed start
// and it becomes a fixed point for everything anchored to it — so a section
// running long cascades the delay down the chain.

export type AnchorType = 'after' | 'before' | 'sun'

export type SolverItem = {
  id: string
  start_time: string | null // 'HH:MM' — absolute time (anchor_type null) or fallback
  end_time: string | null // 'HH:MM' — legacy; infers duration when duration_minutes is null
  duration_minutes: number | null
  anchor_type: AnchorType | null // null = absolute
  anchor_ref: string | null // item id (after/before) or sun key (sun)
  anchor_offset_minutes: number
  pinned: boolean
  actual_start: string | null // 'HH:MM' — live actual
  sort_order: number
}

export type SunMinutes = {
  sunrise?: number | null
  sunset?: number | null
  golden_hour?: number | null
}

export type SolveSource = 'absolute' | 'sun' | 'after' | 'before' | 'actual' | 'unresolved'
export type SolveConflict = 'cycle' | 'missing-ref' | 'missing-sun' | 'no-time' | 'unresolved-ref'

export type SolvedItem = {
  id: string
  startMin: number | null
  endMin: number | null
  durationMin: number | null
  source: SolveSource
  conflicts: SolveConflict[]
}

const SUN_KEYS: Record<string, keyof SunMinutes> = {
  sunrise: 'sunrise',
  sunset: 'sunset',
  golden_hour: 'golden_hour',
}

/** 'HH:MM' → minutes since midnight (supports up to 47:59 for past-midnight). */
export function hhmmToMin(s: string | null | undefined): number | null {
  if (!s) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 47 || mi > 59) return null
  return h * 60 + mi
}

/** minutes → 'HH:MM' (wraps a past-midnight time back into a 24h clock). */
export function minToHhmm(min: number | null | undefined): string | null {
  if (min == null || isNaN(min)) return null
  let m = Math.round(min) % 1440
  if (m < 0) m += 1440
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

function durationOf(it: SolverItem): number | null {
  if (it.duration_minutes != null && it.duration_minutes >= 0) return it.duration_minutes
  const s = hhmmToMin(it.start_time)
  const e = hhmmToMin(it.end_time)
  if (s != null && e != null && e >= s) return e - s
  return null
}

/**
 * Resolve every item to absolute clock minutes. Returns a map keyed by id.
 * Never throws: unresolved items get startMin=null + a conflict tag.
 */
export function solveTimeline(
  items: SolverItem[],
  sun: SunMinutes = {},
  opts: { useActual?: boolean } = {}
): Map<string, SolvedItem> {
  const byId = new Map(items.map((i) => [i.id, i]))
  const out = new Map<string, SolvedItem>()
  const visiting = new Set<string>()
  const cycleNodes = new Set<string>()

  function resolve(id: string): SolvedItem {
    const cached = out.get(id)
    if (cached) return cached

    const it = byId.get(id)
    if (!it) {
      return { id, startMin: null, endMin: null, durationMin: null, source: 'unresolved', conflicts: ['missing-ref'] }
    }

    const dur = durationOf(it)

    // Cycle: this item is already on the resolution stack. Everything currently
    // on the stack is part of the cycle — record them so the final (cached)
    // results carry the flag, then break by falling back to an absolute time.
    if (visiting.has(id)) {
      for (const v of visiting) cycleNodes.add(v)
      const abs = hhmmToMin(it.start_time)
      return {
        id,
        startMin: abs,
        endMin: abs != null ? abs + (dur ?? 0) : null,
        durationMin: dur,
        source: abs != null ? 'absolute' : 'unresolved',
        conflicts: ['cycle'],
      }
    }

    visiting.add(id)
    let startMin: number | null = null
    let source: SolveSource = 'unresolved'
    const conflicts: SolveConflict[] = []

    const actual = opts.useActual ? hhmmToMin(it.actual_start) : null
    if (actual != null) {
      startMin = actual
      source = 'actual'
    } else if (it.anchor_type == null) {
      startMin = hhmmToMin(it.start_time)
      source = startMin != null ? 'absolute' : 'unresolved'
      if (startMin == null) conflicts.push('no-time')
    } else if (it.anchor_type === 'sun') {
      const key = it.anchor_ref ? SUN_KEYS[it.anchor_ref] : undefined
      const base = key ? sun[key] ?? null : null
      if (base == null) {
        conflicts.push('missing-sun')
        startMin = hhmmToMin(it.start_time)
        source = startMin != null ? 'absolute' : 'unresolved'
      } else {
        startMin = base + (it.anchor_offset_minutes || 0)
        source = 'sun'
      }
    } else {
      // after / before
      if (!it.anchor_ref || !byId.has(it.anchor_ref)) {
        conflicts.push('missing-ref')
        startMin = hhmmToMin(it.start_time)
        source = startMin != null ? 'absolute' : 'unresolved'
      } else {
        const ref = resolve(it.anchor_ref)
        if (it.anchor_type === 'after') {
          // Start when the parent finishes (+ offset).
          startMin = ref.endMin != null ? ref.endMin + (it.anchor_offset_minutes || 0) : null
        } else {
          // Start `offset` minutes before the parent begins; duration gives the
          // end (so a 0-duration "before" is a point in time, not a zero span).
          startMin = ref.startMin != null ? ref.startMin - (it.anchor_offset_minutes || 0) : null
        }
        if (startMin != null) {
          source = it.anchor_type
        } else {
          conflicts.push('unresolved-ref')
        }
      }
    }

    visiting.delete(id)
    const endMin = startMin != null ? startMin + (dur ?? 0) : null
    const solved: SolvedItem = { id, startMin, endMin, durationMin: dur, source, conflicts }
    out.set(id, solved)
    return solved
  }

  for (const it of items) resolve(it.id)

  // Stamp the cycle flag onto every member's final result (the flag is detected
  // mid-resolution, before these cached entries exist).
  for (const id of cycleNodes) {
    const s = out.get(id)
    if (s && !s.conflicts.includes('cycle')) s.conflicts.push('cycle')
  }
  return out
}

/**
 * Flag schedule clashes after solving: any two resolved items that overlap in
 * time (start < other's end and vice-versa). Returns pairs of ids. Useful for a
 * "double-booked" hint; informational, not part of resolution.
 */
export function overlappingPairs(solved: Map<string, SolvedItem>): [string, string][] {
  const rows = [...solved.values()]
    .filter((s) => s.startMin != null && s.endMin != null && s.endMin > s.startMin)
    .sort((a, b) => (a.startMin! - b.startMin!) || (a.endMin! - b.endMin!))
  const pairs: [string, string][] = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[j].startMin! >= rows[i].endMin!) break // sorted by start; no later row can overlap row i
      pairs.push([rows[i].id, rows[j].id])
    }
  }
  return pairs
}
