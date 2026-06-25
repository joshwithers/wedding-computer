import type { FC, PropsWithChildren } from 'hono/jsx'
import { SharedHead } from '../head'
import { withDoctype } from '../document'

type Props = PropsWithChildren<{ title?: string }>

export const AuthLayout: FC<Props> = ({ title, children }) => withDoctype(
  <html lang="en">
    <head>
      <SharedHead title={title} />
    </head>
    <body class="bg-papaya-100 text-gray-900 antialiased font-sans min-h-screen flex items-center justify-center">
      <div class="w-full max-w-sm mx-auto px-4 sm:px-6">
        <div class="text-center mb-8">
          <a href="/" class="text-xl font-bold tracking-tight text-gray-900">Wedding Computer</a>
        </div>
        {children}
      </div>
    </body>
  </html>
)
