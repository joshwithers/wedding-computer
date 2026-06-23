import { MarketingLayout } from './layouts/marketing'

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
        aria-label="Copy to clipboard"
      >
        Copy
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

  const capabilities = [
    ['Contacts & leads', 'List, search, and read your contacts; log a new enquiry.'],
    ['Weddings', 'Read a wedding’s details, team, credits, and activity log.'],
    ['Run sheets', 'Read and edit the timeline — add, move, or remove items; start and end live mode on the day.'],
    ['Checklists', 'Read and tick off a wedding’s to-do list.'],
    ['Notes', 'Read and append to shared notes; read and update your private notes.'],
    ['Weather & sun', 'Pull the forecast and add sunrise/sunset times for a wedding date and place.'],
  ]

  return (
    <MarketingLayout title="Connect your AI · Wedding Computer MCP">
      <div class="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <p class="text-xs font-bold uppercase tracking-wide text-horizon-700 mb-2">MCP server</p>
        <h1 class="text-3xl sm:text-4xl font-bold text-gray-900 mb-3">Connect your AI to Wedding Computer</h1>
        <p class="text-lg text-gray-600 mb-8">
          Use Claude, Cursor, or any AI assistant that speaks the{' '}
          <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener" class="text-horizon-600 font-medium hover:underline">
            Model Context Protocol
          </a>{' '}
          to read and update your contacts, weddings, run sheets, checklists, and notes — in plain language.
        </p>

        {/* Prerequisites */}
        <div class="bg-papaya-50 border border-grapefruit-600/20 rounded-2xl p-5 mb-8">
          <h2 class="font-bold text-gray-900 mb-2">Before you start</h2>
          <ul class="text-sm text-gray-700 space-y-1.5 list-disc pl-5">
            <li>
              The MCP server is a <strong>Pro</strong> feature.{' '}
              <a href="/pricing" class="text-horizon-600 font-medium hover:underline">See pricing →</a>
            </li>
            <li>
              <strong>Connecting Claude needs no token</strong> — you sign in and approve (step 1). Only the
              token-based methods (Claude Code, Cursor, scripts) need a <strong>sync token</strong> from{' '}
              <a href="/app/settings#device-sync" class="text-horizon-600 font-medium hover:underline">
                Settings → Calendar &amp; Sync
              </a>{' '}
              — shown once; paste it in place of <code class="bg-white/70 px-1 rounded">YOUR_SYNC_TOKEN</code>.
            </li>
          </ul>
        </div>

        {/* Connection facts */}
        <h2 class="text-xl font-bold text-gray-900 mb-3">Connection details</h2>
        <dl class="border border-gray-200 rounded-2xl divide-y divide-gray-100 mb-10 text-sm">
          <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-4">
            <dt class="w-32 shrink-0 font-medium text-gray-500">Endpoint</dt>
            <dd class="font-mono text-gray-900 break-all">{ENDPOINT}</dd>
          </div>
          <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-4">
            <dt class="w-32 shrink-0 font-medium text-gray-500">Transport</dt>
            <dd class="text-gray-900">Streamable HTTP (JSON-RPC 2.0)</dd>
          </div>
          <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 p-4">
            <dt class="w-32 shrink-0 font-medium text-gray-500">Authentication</dt>
            <dd class="text-gray-900">OAuth 2.1 sign-in (PKCE), or a Bearer sync token</dd>
          </div>
        </dl>

        {/* Setup */}
        <h2 class="text-xl font-bold text-gray-900 mb-4">Set it up</h2>
        <div class="space-y-5">
          <Step n={1} title="Claude — web, desktop & mobile (recommended)">
            <p>No token needed — just sign in and approve:</p>
            <ol class="list-decimal pl-5 space-y-1">
              <li>In Claude, open <strong>Settings → Connectors → Add custom connector</strong>.</li>
              <li>
                Paste <code class="bg-gray-100 px-1 rounded select-all">{ENDPOINT}</code> as the URL and add it.
              </li>
              <li>Claude sends you to Wedding Computer to <strong>sign in and approve</strong> — then you’re connected on every Claude surface.</li>
            </ol>
            <p class="text-gray-500">Manage or disconnect it anytime under Settings → Calendar &amp; Sync → “Connected apps”.</p>
          </Step>

          <Step n={2} title="Claude Code (CLI)">
            <p>Sign-in flow — run this and approve in the browser when prompted:</p>
            <CodeBlock id="cmd-claude-code-oauth" code={`claude mcp add --transport http wedding-computer ${ENDPOINT}`} />
            <p class="text-gray-500">Prefer a token instead of signing in? Add a header:</p>
            <CodeBlock id="cmd-claude-code" code={claudeCode} />
          </Step>

          <Step n={3} title="Cursor, Windsurf & other MCP clients">
            <p>
              Most clients accept a remote URL with a header. For Cursor, add this to <code class="bg-gray-100 px-1 rounded">~/.cursor/mcp.json</code> (others use the same shape):
            </p>
            <CodeBlock id="cmd-cursor" code={cursor} />
          </Step>

          <Step n={4} title="Older clients (manual bridge)">
            <p>
              A client that only speaks stdio can reach the server through the <code class="bg-gray-100 px-1 rounded">mcp-remote</code> bridge — e.g. in <code class="bg-gray-100 px-1 rounded">claude_desktop_config.json</code>:
            </p>
            <CodeBlock id="cmd-claude-desktop" code={claudeDesktop} />
            <p class="text-gray-500">Requires Node.js. The token is kept in <code class="bg-gray-100 px-1 rounded">env</code> so it isn’t split on the space.</p>
          </Step>
        </div>

        {/* Capabilities */}
        <h2 class="text-xl font-bold text-gray-900 mb-4 mt-12">What your assistant can do</h2>
        <div class="grid sm:grid-cols-2 gap-3">
          {capabilities.map(([title, desc]) => (
            <div class="border border-gray-200 rounded-xl p-4">
              <p class="font-bold text-gray-900 text-sm mb-1">{title}</p>
              <p class="text-sm text-gray-600">{desc}</p>
            </div>
          ))}
        </div>
        <p class="text-xs text-gray-400 mt-4">
          Everything is scoped to your account and the weddings you’re a member of. Machine-readable details live in the{' '}
          <a href="/.well-known/mcp/server-card.json" class="text-horizon-600 hover:underline">server card</a>.
        </p>

        <div class="mt-12 pt-6 border-t border-gray-200 text-sm">
          <a href="/app/settings#device-sync" class="text-horizon-600 font-bold hover:underline">Get your sync token →</a>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `document.querySelectorAll('[data-copy]').forEach(function(btn){btn.addEventListener('click',function(){var el=document.getElementById(btn.getAttribute('data-copy'));if(!el)return;navigator.clipboard.writeText(el.innerText).then(function(){var t=btn.textContent;btn.textContent='Copied';setTimeout(function(){btn.textContent=t;},1500);});});});`,
        }}
      />
    </MarketingLayout>
  )
}
