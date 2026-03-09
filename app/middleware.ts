// middleware.ts  (root of project, next to package.json)
import { NextRequest, NextResponse } from 'next/server'

export const config = {
  matcher: ['/(.*)',],
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Never touch API routes or Next.js internals — they handle their own auth
  if (
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const user = process.env.BASIC_AUTH_USER
  const pass = process.env.BASIC_AUTH_PASS
  if (!user || !pass) return NextResponse.next()

  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8')
      const colon = decoded.indexOf(':')
      if (decoded.slice(0, colon) === user && decoded.slice(colon + 1) === pass) {
        return NextResponse.next()
      }
    } catch {}
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Goodwill Hunter"' },
  })
}
