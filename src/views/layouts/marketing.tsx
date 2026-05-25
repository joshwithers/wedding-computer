import type { FC, PropsWithChildren } from 'hono/jsx'
import { SharedHead } from '../head'
import { Logo } from '../logo'

type Props = PropsWithChildren<{ title?: string }>

export const MarketingLayout: FC<Props> = ({ title, children }) => (
  <html lang="en">
    <head>
      <SharedHead title={title} />
    </head>
    <body class="bg-papaya-50 text-gray-900 antialiased font-sans">
      <nav class="bg-grapefruit-700 sticky top-0 z-50">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between">
          <a href="/" class="flex items-center gap-2 text-lg sm:text-xl font-bold tracking-tight text-papaya">
            <Logo class="w-6 h-6 sm:w-7 sm:h-7" />
            Wedding Computer
          </a>
          <div class="flex items-center gap-2 sm:gap-6">
            <a href="/pricing" class="text-sm font-medium text-papaya-200 hover:text-white transition-colors">Pricing</a>
            <a href="/about" class="text-sm font-medium text-papaya-200 hover:text-white transition-colors">About</a>
            <a href="/login" class="text-sm font-semibold bg-white text-grapefruit-700 px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl hover:bg-papaya transition-colors">
              Sign in
            </a>
          </div>
        </div>
      </nav>
      <main>{children}</main>
      <footer class="border-t border-papaya-300/30 mt-24 bg-white/50">
        <div class="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 text-sm text-gray-500 font-medium">
          &copy; {new Date().getFullYear()} Wedding Computer
        </div>
      </footer>
    </body>
  </html>
)
