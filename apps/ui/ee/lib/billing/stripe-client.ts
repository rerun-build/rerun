import type { Stripe } from '@stripe/stripe-js'
import { loadStripe } from '@stripe/stripe-js/pure'

// The browser half of Stripe, kept away from lib/billing/stripe.ts, which holds the secret key and
// is server-only. Loaded once per tab: `loadStripe` injects a script tag, and calling it per render
// would inject it again.
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
