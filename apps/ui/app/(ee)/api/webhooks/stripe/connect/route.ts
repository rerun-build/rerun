import type Stripe from 'stripe'
import { markCreatorAccountDeauthorized, syncCreatorAccount } from '@/ee/services/connect.service'
import { stripe } from '@/ee/lib/billing/stripe'
import { claimStripeEvent, markStripeEventProcessed, releaseStripeEvent, unclaimedResponse } from '../idempotency'

export async function POST(req: Request) {
    const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET
    if (!secret) return Response.json({ error: 'STRIPE_CONNECT_WEBHOOK_SECRET is not configured' }, { status: 500 })

    const sig = req.headers.get('stripe-signature')
    if (!sig) return Response.json({ error: 'Missing signature' }, { status: 400 })

    const raw = await req.text()
    let event: Stripe.Event
    try {
        event = await stripe.webhooks.constructEventAsync(raw, sig, secret)
    } catch (err) {
        return Response.json({ error: `Invalid signature: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 400 })
    }

    const claim = await claimStripeEvent(event)
    if (claim !== 'claimed') return unclaimedResponse(claim)

    try {
        switch (event.type) {
            case 'account.updated':
                await syncCreatorAccount(event.data.object)
                break
            case 'account.application.deauthorized':
                await markCreatorAccountDeauthorized(event.account)
                break
        }
        await markStripeEventProcessed(event.id)
    } catch (err) {
        await releaseStripeEvent(event.id)
        console.error('[stripe connect webhook] handler failed', event.type, err)
        return Response.json({ error: 'Handler failed' }, { status: 500 })
    }

    return Response.json({ received: true }, { status: 200 })
}
