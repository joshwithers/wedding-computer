/** Wedding title with its emoji prefix, e.g. "🌸 Sarah & James". */
export function weddingDisplayTitle(w: { title: string; emoji?: string | null }): string {
  return w.emoji ? `${w.emoji} ${w.title}` : w.title
}
