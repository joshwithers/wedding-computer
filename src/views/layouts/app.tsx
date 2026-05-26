import type { FC, PropsWithChildren } from 'hono/jsx'
import type { User, VendorProfile } from '../../types'
import { SharedHead } from '../head'
import { Logo } from '../logo'

type Props = PropsWithChildren<{
  title?: string
  user: User
  vendor?: VendorProfile
  csrfToken: string
}>

export const AppLayout: FC<Props> = ({ title, user, vendor, csrfToken, children }) => (
  <html lang="en">
    <head>
      <SharedHead title={title} />
      <script src="https://unpkg.com/htmx.org@2.0.4"></script>
      <meta name="csrf-token" content={csrfToken} />
    </head>
    <body class="bg-papaya-50 text-gray-900 antialiased font-sans" hx-headers={`{"X-CSRF-Token": "${csrfToken}"}`}>
      {/* Mobile header + nav */}
      <div class="md:hidden sticky top-0 z-50">
        <header class="bg-grapefruit-700 px-4 py-3 flex items-center justify-between">
          <a href="/app" class="flex items-center gap-2 text-sm font-bold tracking-tight text-papaya whitespace-nowrap">
            <Logo class="w-5 h-5 shrink-0" />
            Wedding Computer
          </a>
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <button
              type="button"
              onclick="document.getElementById('mobile-nav').classList.toggle('hidden')"
              class="p-1.5 text-papaya-200 hover:text-white"
              aria-label="Toggle menu"
            >
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </header>
        <nav id="mobile-nav" class="hidden bg-white border-b border-papaya-300/30 px-4 py-2 shadow-lg shadow-gray-900/5">
          <div class="space-y-1">
            <MobileNavLink href="/app" label="Dashboard" />
            <MobileNavLink href="/app/contacts" label="Contacts" />
            <MobileNavLink href="/app/weddings" label="Weddings" />
            <MobileNavLink href="/app/calendar" label="Calendar" />
            <MobileNavLink href="/app/invoices" label="Invoices" />
            <MobileNavLink href="/app/emails" label="Emails" />
            <MobileNavLink href="/app/form" label="Enquiry Form" />
            <MobileNavLink href="/app/booking-form" label="Booking Form" />
            <MobileNavLink href="/app/contract" label="Contract" />
            <MobileNavLink href="/app/analytics" label="Analytics" />
            <MobileNavLink href="/app/subscription" label="Subscription" />
            <div class="border-t border-papaya-300/30 mt-2 pt-2">
              <MobileNavLink href="/account" label="Your Profile" />
              <MobileNavLink href="/app/settings" label="Settings" />
              {user.is_admin === 1 && <MobileNavLink href="/admin" label="Admin" />}
              <form method="post" action="/logout">
                <input type="hidden" name="_csrf" value={csrfToken} />
                <button type="submit" class="w-full text-left px-3 py-2.5 text-sm font-medium text-gray-500 hover:bg-papaya-100 rounded-xl">
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </nav>
      </div>

      <div class="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside class="hidden md:flex md:flex-col w-56 bg-grapefruit-700 shrink-0">
          <div class="px-5 py-5 border-b border-white/10">
            <a href="/app" class="flex items-center gap-2 text-base font-bold tracking-tight text-papaya whitespace-nowrap">
              <Logo class="w-5 h-5 shrink-0" />
              Wedding Computer
            </a>
          </div>
          <nav class="flex-1 px-3 py-4 space-y-1">
            <SidebarLink href="/app" label="Dashboard" />
            <SidebarLink href="/app/contacts" label="Contacts" />
            <SidebarLink href="/app/weddings" label="Weddings" />
            <SidebarLink href="/app/calendar" label="Calendar" />
            <SidebarLink href="/app/invoices" label="Invoices" />
            <SidebarLink href="/app/emails" label="Emails" />
            <SidebarLink href="/app/form" label="Enquiry Form" />
            <SidebarLink href="/app/booking-form" label="Booking Form" />
            <SidebarLink href="/app/contract" label="Contract" />
            <SidebarLink href="/app/analytics" label="Analytics" />
          </nav>
          <div class="px-3 py-4 border-t border-white/10 space-y-1">
            <SidebarLink href="/account" label="Your Profile" />
            <SidebarLink href="/app/settings" label="Settings" />
            <form method="post" action="/logout" class="block">
              <input type="hidden" name="_csrf" value={csrfToken} />
              <button type="submit" class="block w-full text-left px-3 py-2 text-sm font-medium text-papaya-200 hover:bg-white/10 hover:text-white rounded-xl transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </aside>
        {/* Main content */}
        <div class="flex-1 flex flex-col min-w-0">
          <header class="hidden md:flex bg-white border-b border-gray-200 px-8 py-4 items-center justify-between">
            <div class="text-lg font-bold text-gray-900">{title ?? 'Dashboard'}</div>
            <a href="/account" class="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <span class="text-sm font-medium text-gray-600">{vendor?.business_name ?? user.name}</span>
              {user.avatar_r2_key ? (
                <img src={`/avatar/${user.id}`} alt={user.name} class="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div class="w-8 h-8 bg-grapefruit-100 rounded-full flex items-center justify-center text-xs font-bold text-grapefruit-700">
                  {user.name.charAt(0).toUpperCase()}
                </div>
              )}
            </a>
          </header>
          <main class="flex-1 px-4 py-4 sm:px-6 sm:py-5 md:px-8 md:py-6">{children}</main>
        </div>
      </div>
    </body>
  </html>
)

const SidebarLink: FC<{ href: string; label: string }> = ({ href, label }) => (
  <a
    href={href}
    class="block px-3 py-2 text-sm font-medium text-papaya-200 hover:bg-white/10 hover:text-white rounded-xl transition-colors"
  >
    {label}
  </a>
)

const MobileNavLink: FC<{ href: string; label: string }> = ({ href, label }) => (
  <a
    href={href}
    class="block px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-papaya-100 hover:text-horizon-700 rounded-xl transition-colors"
  >
    {label}
  </a>
)
