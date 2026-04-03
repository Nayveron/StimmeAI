import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { prisma } from '@/lib/prisma'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const clerkUserId = session.metadata?.clerkUserId

    if (clerkUserId) {
      // Key line: upsert subscription — creates if new, updates if exists
      await prisma.subscription.upsert({
        where: { stripeCustomerId: session.customer as string },
        create: {
          user: { connect: { clerkId: clerkUserId } },
          stripeCustomerId: session.customer as string,
          stripeSubscriptionId: session.subscription as string,
          stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_ID!,
          status: 'active',
        },
        update: { status: 'active' },
      })
    }
  }

  return NextResponse.json({ received: true })
}
