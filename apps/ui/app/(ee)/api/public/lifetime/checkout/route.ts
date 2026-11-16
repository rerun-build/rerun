import { BILLING_ENABLED } from '@rerun/cloud/billing'
import { createLifetimeCheckoutUrl } from '@/ee/services/lifetime-deal.service'

// The "Get lifetime access" button of rerun.build/lifetime: no account needed to pay, the code is
// redeemed on a workspace afterwards. A link and not a form, so the landing stays a static page.
// Under api/public/, which the proxy leaves alone: a click must not mint an anonymous user and a
// workspace for someone who is only on their way to Stripe.
export async function GET(): Promise<Response> {
    if (!BILLING_ENABLED) return new Response(null, { status: 404 })
    return Response.redirect(await createLifetimeCheckoutUrl(), 303)
}
