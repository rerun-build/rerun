import { loadStripe, type Stripe } from '@stripe/stripe-js'

let cached: Promise<Stripe | null> | null = null

export function stripeBrowser(): Promise<Stripe | null> {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
    if (!key) {
        console.error('[billing] NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing, the embedded checkout cannot load')
        return Promise.resolve(null)
    }
    cached ??= loadStripe(key)
    return cached
}
