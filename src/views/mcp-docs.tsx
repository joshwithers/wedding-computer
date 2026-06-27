import { MarketingLayout } from './layouts/marketing'
import { getCspNonce, t } from '../i18n'
import type { MessageKey } from '../i18n'

/**
 * Public, human-facing setup guide served at GET /mcp when opened in a browser
 * (content-negotiated against the JSON server descriptor that MCP clients get).
 * The sync token is stored hashed and only shown once at generation, so every
 * command here uses a YOUR_SYNC_TOKEN placeholder and links to Settings.
 */

const ENDPOINT = 'https://wedding.computer/mcp'

function CodeBlock({ id, code }: { id: string; code: string }) {
  return (
    <div class="relative group">
      <pre
        id={id}
        class="bg-gray-900 text-gray-100 text-xs sm:text-sm rounded-xl p-4 pr-12 overflow-x-auto whitespace-pre leading-relaxed"
      >
        {code}
      </pre>
      <button
        type="button"
        data-copy={id}
        class="absolute top-2.5 right-2.5 text-xs font-medium text-gray-300 bg-white/10 hover:bg-white/20 rounded-md px-2 py-1 transition-colors"
        aria-label={t('marketing.mcpDocs.copy.aria')}
      >
        {t('marketing.mcpDocs.copy.idle')}
      </button>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: any }) {
  return (
    <div class="border border-gray-200 rounded-2xl p-5 sm:p-6">
      <div class="flex items-center gap-3 mb-3">
        <span class="w-7 h-7 shrink-0 rounded-full bg-horizon-100 text-horizon-700 font-bold text-sm flex items-center justify-center">
          {n}
        </span>
        <h3 class="font-bold text-gray-900">{title}</h3>
      </div>
      <div class="space-y-3 text-sm text-gray-600">{children}</div>
    </div>
  )
}

export function McpDocsPage() {
  const claudeCode = `claude mcp add --transport http wedding-computer \\
  ${ENDPOINT} \\
  --header "Authorization: Bearer YOUR_SYNC_TOKEN"`

  const claudeDesktop = `{
  "mcpServers": {
    "wedding-computer": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote", "${ENDPOINT}",
        "--header", "Authorization:\${WC_TOKEN}"
      ],
      "env": { "WC_TOKEN": "Bearer YOUR_SYNC_TOKEN" }
    }
  }
}`

  const cursor = `{
  "mcpServers": {
    "wedding-computer": {
      "url": "${ENDPOINT}",
      "headers": { "Authorization": "Bearer YOUR_SYNC_TOKEN" }
    }
  }
}`

  const capabilities: Array<[MessageKey, MessageKey]> = [
    ['marketing.mcpDocs.capabilities.contacts.title', 'marketing.mcpDocs.capabilities.contacts.desc'],
    ['marketing.mcpDocs.capabilities.weddings.title', 'marketing.mcpDocs.capabilities.weddings.desc'],
    ['marketing.mcpDocs.capabilities.runSheets.title', 'marketing.mcpDocs.capabilities.runSheets.desc'],
    ['marketing.mcpDocs.capabilities.checklists.title', 'marketing.mcpDocs.capabilities.checklists.desc'],
    ['marketing.mcpDocs.capabilities.notes.title', 'marketing.mcpDocs.capabilities.notes.desc'],
    ['marketing.mcpDocs.capabilities.weather.title', 'marketing.mcpDocs.capabilities.weather.desc'],
  ]

  return (
    <MarketingLayout title={t('marketing.mcpDocs.metaTitle')}>
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <p class="text-xs font-bold uppercase tracking-wide text-horizon-700 mb-2">{t('marketing.mcpDocs.eyebrow')}</p>
        <h1 class="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">{t('marketing.mcpDocs.title')}</h1>
        <p class="text-lg text-gray-600 mb-8">
          {t('marketing.mcpDocs.intro.beforeProtocol')}{' '}
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener" class="text-horizon-600 font-medium hover:underline">
            Model Context Protocol
          </a>{' '}
          {t('marketing.mcpDocs.intro.afterProtocol')}
        </p>

        {/* Prerequisites */}
        <div class="bg-papaya-50 border border-grapefruit-600/20 rounded-2xl p-5 mb-8">
          <h2 class="font-bold text-gray-900 mb-2">{t('marketing.mcpDocs.before.title')}</h2>
          <ul class="text-sm text-gray-700 space-y-1.5 list-disc pl-5">
            <li>
              {t('marketing.mcpDocs.before.proFeature')}{' '}
              <a href="/pricing" class="text-horizon-600 font-medium hover:underline">{t('marketing.mcpDocs.before.pricingLink')}</a>
            </li>
            <li>
              {t('marketing.mcpDocs.before.tokenPrefix')}{' '}
              <a href="/app/settings#device-sync" class="text-horizon-600 font-medium hover:underline">
                {t('marketing.mcpDocs.settingsPath')}
              </a>{' '}
              {t('marketing.mcpDocs.before.tokenSuffix')}{' '}
              <code class="bg-white/70 px-1 rounded">YOUR_SYNC_TOKEN</code>.
            </li>
          </ul>
        </div>

        {/* Connection facts */}
        <h2 class="text-xl font-bold text-gray-900 mb-3">{t('marketing.mcpDocs.connection.title')}</h2>
        <dl class="border border-gray-200 rounded-2xl divide-y divide-gray-100 mb-10 text-sm">
          <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-4">
            <dt class="w-32 shrink-0 font-medium text-gray-500">{t('marketing.mcpDocs.connection.endpoint')}</dt>
            <dd class="font-mono text-gray-900 break-all">{ENDPOINT}</dd>
          </div>
          <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-4">
            <dt class="w-32 shrink-0 font-medium text-gray-500">{t('marketing.mcpDocs.connection.transport')}</dt>
            <dd class="text-gray-900">{t('marketing.mcpDocs.connection.transportValue')}</dd>
          </div>
          <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-4">
            <dt class="w-32 shrink-0 font-medium text-gray-500">{t('marketing.mcpDocs.connection.authentication')}</dt>
            <dd class="text-gray-900">{t('marketing.mcpDocs.connection.authenticationValue')}</dd>
          </div>
        </dl>

        {/* Setup */}
        <h2 class="text-xl font-bold text-gray-900 mb-4">{t('marketing.mcpDocs.setup.title')}</h2>
        <div class="space-y-5">
          <Step n={1} title={t('marketing.mcpDocs.setup.claude.title')}>
            <p>{t('marketing.mcpDocs.setup.claude.intro')}</p>
            <ol class="list-decimal pl-5 space-y-1">
              <li>{t('marketing.mcpDocs.setup.claude.step1')}</li>
              <li>
                {t('marketing.mcpDocs.setup.claude.step2Prefix')}{' '}
                <code class="bg-gray-100 px-1 rounded select-all">{ENDPOINT}</code>{' '}
                {t('marketing.mcpDocs.setup.claude.step2Suffix')}
              </li>
              <li>{t('marketing.mcpDocs.setup.claude.step3')}</li>
            </ol>
            <p class="text-gray-500">{t('marketing.mcpDocs.setup.claude.manage')}</p>
          </Step>

          <Step n={2} title={t('marketing.mcpDocs.setup.claudeCode.title')}>
            <p>{t('marketing.mcpDocs.setup.claudeCode.signIn')}</p>
            <CodeBlock id="cmd-claude-code-oauth" code={`claude mcp add --transport http wedding-computer ${ENDPOINT}`} />
            <p class="text-gray-500">{t('marketing.mcpDocs.setup.claudeCode.token')}</p>
            <CodeBlock id="cmd-claude-code" code={claudeCode} />
          </Step>

          <Step n={3} title={t('marketing.mcpDocs.setup.clients.title')}>
            <p>
              {t('marketing.mcpDocs.setup.clients.body', { path: '~/.cursor/mcp.json' })}
            </p>
            <CodeBlock id="cmd-cursor" code={cursor} />
          </Step>

          <Step n={4} title={t('marketing.mcpDocs.setup.bridge.title')}>
            <p>
              {t('marketing.mcpDocs.setup.bridge.body', { bridge: 'mcp-remote', config: 'claude_desktop_config.json' })}
            </p>
            <CodeBlock id="cmd-claude-desktop" code={claudeDesktop} />
            <p class="text-gray-500">{t('marketing.mcpDocs.setup.bridge.note', { env: 'env' })}</p>
          </Step>
        </div>

        {/* Capabilities */}
        <h2 class="text-xl font-bold text-gray-900 mb-4 mt-12">{t('marketing.mcpDocs.capabilities.title')}</h2>
        <div class="grid sm:grid-cols-2 gap-3">
          {capabilities.map(([titleKey, descKey]) => (
            <div class="border border-gray-200 rounded-xl p-4">
              <p class="font-bold text-gray-900 text-sm mb-1">{t(titleKey)}</p>
              <p class="text-sm text-gray-600">{t(descKey)}</p>
            </div>
          ))}
        </div>
        <p class="text-xs text-gray-400 mt-4">
          {t('marketing.mcpDocs.scope.prefix')}{' '}
          <a href="/.well-known/mcp/server-card.json" class="text-horizon-600 hover:underline">{t('marketing.mcpDocs.scope.serverCard')}</a>.
        </p>

        <div class="mt-12 pt-6 border-t border-gray-200 text-sm">
          <a href="/app/settings#device-sync" class="text-horizon-600 font-bold hover:underline">{t('marketing.mcpDocs.cta.syncToken')}</a>
        </div>
      </div>

      <script
        nonce={getCspNonce()}
        dangerouslySetInnerHTML={{
          __html: `document.querySelectorAll('[data-copy]').forEach(function(btn){btn.addEventListener('click',function(){var el=document.getElementById(btn.getAttribute('data-copy'));if(!el)return;navigator.clipboard.writeText(el.innerText).then(function(){var originalText=btn.textContent;btn.textContent=${JSON.stringify(t('marketing.mcpDocs.copy.done'))};setTimeout(function(){btn.textContent=originalText;},1500);});});});`,
        }}
      />
    </MarketingLayout>
  )
}
