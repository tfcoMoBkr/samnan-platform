import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_PREFIXES = [
  '/dashboard', '/projects', '/installation', '/users', '/payments',
  '/reports', '/purchase-requests', '/audit-log', '/technicians',
  '/notebook', '/profile',
]

// Paths that must never wait on the auth service: the customer share page and
// the auth callback are reached by people who have no session at all.
const PUBLIC_PREFIXES = ['/track', '/auth']

// Supabase's auth service is a network hop away. Vercel kills a middleware
// invocation that runs long (users saw MIDDLEWARE_INVOCATION_TIMEOUT / 504),
// so the call is bounded and we fail OPEN on timeout: every protected page and
// every server action re-checks the session itself, so letting a request
// through costs nothing but a redirect one layer later — whereas blocking it
// takes the whole platform down whenever auth is slow.
const AUTH_TIMEOUT_MS = 3000

// Service kill switch. Set SERVICE_SUSPENDED=true in Vercel and redeploy: every
// page, server action, API route and cron then gets the suspension notice
// (503) instead. Nothing in the database or storage is touched — remove the
// variable (or set it to anything else) and redeploy to restore the platform
// exactly as it was.
const SUSPENDED_PATH = '/suspended'

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (process.env.SERVICE_SUSPENDED === 'true') {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'service_suspended' }, { status: 503 })
    }
    return NextResponse.rewrite(new URL(SUSPENDED_PATH, request.url), { status: 503 })
  }

  // The notice page is meaningless while the service is running.
  if (pathname === SUSPENDED_PATH) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next({ request })
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))
  const isAuthPage = pathname === '/login' || pathname === '/signup'

  // Nothing to decide here — skip the round trip entirely.
  if (!isProtected && !isAuthPage) {
    return NextResponse.next({ request })
  }

  // A session always leaves an `sb-<ref>-auth-token` cookie (possibly chunked).
  // With no such cookie the user is definitively signed out, so we can answer
  // without calling Supabase at all — which is the common case for the login
  // page and for links opened by people who aren't logged in.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))

  if (!hasAuthCookie) {
    if (isProtected) return NextResponse.redirect(new URL('/login', request.url))
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...(options as Record<string, unknown>),
              maxAge: 60 * 60 * 24 * 7,
              sameSite: 'lax',
              secure: process.env.NODE_ENV === 'production',
            } as Parameters<typeof supabaseResponse.cookies.set>[2])
          )
        },
      },
    }
  )

  // `timedOut` is distinct from "no user": on a timeout we must not redirect a
  // signed-in user to /login, which would look like being logged out at random.
  const timedOut = Symbol('timeout')
  let user: { id: string } | null = null
  try {
    const result = await Promise.race([
      supabase.auth.getUser().then((r) => r.data.user),
      new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), AUTH_TIMEOUT_MS)),
    ])
    if (result === timedOut) {
      console.warn('[middleware] auth check timed out — passing through', pathname)
      return supabaseResponse
    }
    user = result
  } catch (e) {
    console.error('[middleware] auth check failed — passing through', e)
    return supabaseResponse
  }

  if (!user && isProtected) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthPage) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  // Everything except build assets and images, so the kill switch above covers
  // every route. Requests outside PROTECTED_PREFIXES / the auth pages still
  // return before any auth round trip, so this adds no calls to Supabase.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|ttf|otf)$).*)',
  ],
}
