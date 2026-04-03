import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/checkout(.*)',
  '/api/records(.*)',
  '/api/subscription(.*)',
])

export const proxy = clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) await auth.protect()
})

export const config = {
  // Exclude Stripe webhook entirely — proxy must never touch it,
  // otherwise the body stream gets consumed and signature verification fails
  matcher: [
    '/((?!.*\\..*|_next|api/stripe/webhook).*)',
    '/',
    '/(api(?!/stripe/webhook)|trpc)(.*)',
  ],
}
