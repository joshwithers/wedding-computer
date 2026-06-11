import type { FC, PropsWithChildren } from 'hono/jsx'
import { getI18n, PUBLIC_LOCALES, t } from '../../i18n'
import { SharedHead } from '../head'
import { Logo } from '../logo'

type Props = PropsWithChildren<{ title?: string }>

const primaryLanguage = (tag: string) => tag.split('-')[0].toLowerCase()

const LanguageSwitcher: FC<{ placement: 'nav' | 'footer' }> = ({ placement }) => {
  const currentLocale = getI18n().locale
  const currentLanguage = primaryLanguage(currentLocale)
  const current =
    PUBLIC_LOCALES.find((l) => l.tag === currentLocale) ??
    PUBLIC_LOCALES.find((l) => primaryLanguage(l.tag) === currentLanguage) ??
    PUBLIC_LOCALES[0]
  const isNav = placement === 'nav'

  return (
    <form method="post" action="/locale" class={`relative ${isNav ? 'hidden sm:block' : 'w-full sm:w-auto'}`}>
      <label for={`locale-${placement}`} class="sr-only">{t('marketing.nav.language')}</label>
      <input type="hidden" name="return_to" value="/" data-locale-return-to />
      <svg
        class={`pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 ${isNav ? 'text-papaya-200' : 'text-gray-400'}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
      <select
        id={`locale-${placement}`}
        name="locale"
        aria-label={`${t('marketing.nav.language')}: ${current.label}`}
        onchange="this.form.submit()"
        class={`${isNav ? 'w-40 bg-grapefruit-800/40 text-papaya-50 border-papaya-300/30 hover:bg-grapefruit-800/60 focus:ring-papaya-300' : 'w-full sm:w-52 bg-white text-gray-700 border-gray-200 hover:border-gray-300 focus:ring-horizon-500'} appearance-none rounded-xl border py-2 pl-9 pr-8 text-sm font-semibold transition-colors focus:outline-none focus:ring-2`}
      >
        {PUBLIC_LOCALES.map((locale) => (
          <option value={locale.tag} selected={locale.tag === current.tag}>
            {locale.label}
          </option>
        ))}
      </select>
      <svg
        class={`pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 ${isNav ? 'text-papaya-200' : 'text-gray-400'}`}
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clip-rule="evenodd" />
      </svg>
      <noscript>
        <button type="submit" class="ml-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700">
          {t('common.save')}
        </button>
      </noscript>
    </form>
  )
}

export const MarketingLayout: FC<Props> = ({ title, children }) => (
  <html lang={getI18n().locale}>
    <head>
      <SharedHead title={title} />
    </head>
    <body class="bg-papaya-50 text-gray-900 antialiased font-sans">
      <nav class="bg-grapefruit-700 sticky top-0 z-50">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <a href="/" class="flex items-center gap-2 text-base sm:text-xl font-bold tracking-tight text-papaya whitespace-nowrap">
            <Logo class="w-5 h-5 sm:w-7 sm:h-7 shrink-0" />
            Wedding Computer
          </a>
          <div class="flex items-center gap-3 sm:gap-6">
            <a href="/pricing" class="hidden sm:inline text-sm font-medium text-papaya-200 hover:text-white transition-colors">{t('marketing.nav.pricing')}</a>
            <a href="/about" class="hidden sm:inline text-sm font-medium text-papaya-200 hover:text-white transition-colors">{t('marketing.nav.about')}</a>
            <LanguageSwitcher placement="nav" />
            <a href="/login" class="text-sm font-semibold bg-white text-grapefruit-700 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl hover:bg-papaya transition-colors whitespace-nowrap">
              {t('marketing.nav.signIn')}
            </a>
          </div>
        </div>
      </nav>
      <main>{children}</main>
      <footer class="border-t border-papaya-300/30 mt-24 bg-white/50">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div class="flex flex-col sm:flex-row items-center justify-between gap-4">
            <span class="text-sm text-gray-500 font-medium">&copy; {new Date().getFullYear()} Wedding Computer</span>
            <div class="flex items-center gap-4 sm:gap-6 flex-wrap justify-center">
              <a href="/about" class="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">{t('marketing.nav.about')}</a>
              <a href="/pricing" class="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">{t('marketing.nav.pricing')}</a>
              <a href="/standard" class="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">{t('marketing.nav.openStandard')}</a>
              <a href="/docs/plain-text" class="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">{t('marketing.nav.docs')}</a>
              <a href="/login" class="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">{t('marketing.nav.signIn')}</a>
            </div>
            <LanguageSwitcher placement="footer" />
          </div>
        </div>
      </footer>
      <script dangerouslySetInnerHTML={{ __html: `
(function() {
  if (!navigator.modelContext || !navigator.modelContext.provideContext) return;
  navigator.modelContext.provideContext({
    tools: [
      {
        name: "get_started",
        description: ${JSON.stringify(t('marketing.agent.getStarted.desc'))},
        inputSchema: { type: "object", properties: {} },
        execute: function() { window.location.href = "/login"; return { success: true }; }
      },
      {
        name: "view_pricing",
        description: ${JSON.stringify(t('marketing.agent.viewPricing.desc'))},
        inputSchema: { type: "object", properties: {} },
        execute: function() { window.location.href = "/pricing"; return { success: true }; }
      },
      {
        name: "view_about",
        description: ${JSON.stringify(t('marketing.agent.viewAbout.desc'))},
        inputSchema: { type: "object", properties: {} },
        execute: function() { window.location.href = "/about"; return { success: true }; }
      },
      {
        name: "view_data_format",
        description: ${JSON.stringify(t('marketing.agent.viewDataFormat.desc'))},
        inputSchema: { type: "object", properties: {} },
        execute: function() { window.location.href = "/standard"; return { success: true }; }
      },
      {
        name: "view_mcp_server",
        description: ${JSON.stringify(t('marketing.agent.viewMcpServer.desc'))},
        inputSchema: { type: "object", properties: {} },
        execute: function() {
          return {
            url: "https://wedding.computer/mcp",
            transport: "streamable-http",
            auth: ${JSON.stringify(t('marketing.agent.viewMcpServer.auth'))},
            serverCard: "https://wedding.computer/.well-known/mcp/server-card.json"
          };
        }
      }
    ]
  });
})();
      ` }} />
      <script dangerouslySetInnerHTML={{ __html: `
(function() {
  var current = window.location.pathname + window.location.search + window.location.hash;
  document.querySelectorAll('[data-locale-return-to]').forEach(function(input) {
    input.value = current || '/';
  });
})();
      ` }} />
    </body>
  </html>
)
