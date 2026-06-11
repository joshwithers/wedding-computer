import type { FC, PropsWithChildren } from 'hono/jsx'
import { getI18n, t } from '../../i18n'
import { SharedHead } from '../head'
import { Logo } from '../logo'

type Props = PropsWithChildren<{ title?: string }>

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
    </body>
  </html>
)
