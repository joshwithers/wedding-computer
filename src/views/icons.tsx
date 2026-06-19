// Small shared inline icons + a copy-to-clipboard icon button.

/**
 * A copy-to-clipboard button rendered as an icon. On click it writes `value`
 * to the clipboard and briefly swaps the copy glyph for a checkmark.
 *
 * `class` styles the <button> so callers control size/shape per context.
 */
export function CopyButton({
  value,
  title,
  class: cls = '',
}: {
  value: string
  title: string
  class?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onclick={`navigator.clipboard.writeText(${JSON.stringify(
        value,
      )});const i=this.querySelector('[data-copy]'),k=this.querySelector('[data-check]');if(i&&k){i.classList.add('hidden');k.classList.remove('hidden');setTimeout(()=>{i.classList.remove('hidden');k.classList.add('hidden')},1500)}`}
      class={`inline-flex items-center justify-center ${cls}`}
    >
      <svg data-copy class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="1.5"
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
      <svg data-check class="hidden w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.5 12.75l6 6 9-13.5" />
      </svg>
    </button>
  )
}
