import { html } from 'hono/html'

export function withDoctype(document: unknown) {
  return html`<!DOCTYPE html>${document}`
}
