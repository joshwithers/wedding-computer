// English — the source dictionary, assembled from per-surface fragments in
// ./en/. Every user-facing string in the app keys off this merged object;
// its keys are the canonical set (`MessageKey` in ./index.ts).
//
// Conventions:
// - Keys are dot-namespaced by surface: `nav.contacts`, `dashboard.title`.
// - Interpolation slots use {curly} names: `t('hello', { name })`.
// - Plural pairs use `.one` / `.other` suffixes and are read via `tp()`.
// - Reuse `common.*` keys before coining new ones.

import { common } from './en/common'
import { nav } from './en/nav'
import { dashboard } from './en/dashboard'
import { account } from './en/account'
import { auth } from './en/auth'
import { contacts } from './en/contacts'
import { weddings } from './en/weddings'
import { docs } from './en/docs'
import { links } from './en/links'
import { timeline } from './en/timeline'
import { couple } from './en/couple'
import { settings } from './en/settings'
import { billing } from './en/billing'
import { forms } from './en/forms'
import { planning } from './en/planning'
import { onboarding } from './en/onboarding'
import { email } from './en/email'
import { comms } from './en/comms'
import { marketing } from './en/marketing'
import { legal } from './en/legal'

export const en = {
  ...common,
  ...nav,
  ...dashboard,
  ...account,
  ...auth,
  ...contacts,
  ...weddings,
  ...docs,
  ...links,
  ...timeline,
  ...couple,
  ...settings,
  ...billing,
  ...forms,
  ...planning,
  ...onboarding,
  ...email,
  ...comms,
  ...marketing,
  ...legal,
} as const
