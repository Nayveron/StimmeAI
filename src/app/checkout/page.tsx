'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function CheckoutPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'loading' | 'redirecting'>('loading')

  useEffect(() => {
    async function redirect() {
      // Check if user already has an active subscription
      const res = await fetch('/api/subscription/status')
      const { active } = await res.json()

      if (active) {
        // Already subscribed — go straight to dashboard
        router.replace('/dashboard')
        return
      }

      // No subscription — redirect to Stripe checkout
      setStatus('redirecting')
      const checkoutRes = await fetch('/api/stripe/checkout', { method: 'POST' })
      const { url } = await checkoutRes.json()
      if (url) {
        window.location.href = url
      } else {
        // Fallback if checkout creation fails
        router.replace('/dashboard')
      }
    }

    redirect()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#07070d]">
      <div className="text-center">
        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center mx-auto mb-4 animate-pulse">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </div>
        <p className="text-white/50 text-sm">
          {status === 'loading' ? 'Checking subscription...' : 'Redirecting to payment...'}
        </p>
      </div>
    </div>
  )
}
