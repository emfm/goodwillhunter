// middleware.ts  (root of project, next to package.json)
import { NextRequest, NextResponse } from 'next/server'

export const config = {
  // Only protect pages — never API routes (they handle their own auth)
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|api/).+)',
    '/'
  ],
}

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER
  const pass = process.env.BASIC_AUTH_PASS

  // Not configured = dev mode, allow through
  if (!user || !pass) return NextResponse.next()

  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf-8')
      const colon = decoded.indexOf(':')
      const u = decoded.slice(0, colon)
      const p = decoded.slice(colon + 1)
      if (u === user && p === pass) return NextResponse.next()
    } catch {}
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Goodwill Hunter", charset="UTF-8"' },
  })
}
