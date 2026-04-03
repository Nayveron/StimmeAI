import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher([
  '/dashboard(.*)',
  '/checkout(.*)',
  '/api/records(.*)',
  '/api/subscription(.*)',
])

// Stripe webhook must be excluded — Clerk modifies the request which breaks signature verification
const isWebhookRoute = createRouteMatcher(['/api/stripe/webhook'])

export const proxy = clerkMiddleware(async (auth, req) => {
  // Skip Clerk processing entirely for Stripe webhook
  if (isWebhookRoute(req)) return
  if (isProtectedRoute(req)) await auth.protect()
})

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
}
