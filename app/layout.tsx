import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Goodwill Hunter',
  description: 'Automated thrift deal finder',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
