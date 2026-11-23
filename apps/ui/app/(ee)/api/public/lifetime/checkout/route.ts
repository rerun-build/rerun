import { BILLING_ENABLED } from '@rerun/cloud/billing'
import { createLifetimeCheckoutUrl } from '@/ee/services/lifetime-deal.service'
import { landingUrl } from '@/lib/site'

// A path of the landing, never a URL: an open redirect would let anyone send a buyer elsewhere.
const LANDING_PATH = /^\/[\w-]+(\/[\w-]+)*$/

// The "Get lifetime access" button of the lifetime deal page: no account needed to pay, the code is
// redeemed on a workspace afterwards. A link and not a form, so the landing stays a static page.
// The page sits at an unlisted path of the landing, named only there: it passes it as `from`, so a
// buyer who leaves Checkout comes back to it.
// Under api/public/, which the proxy leaves alone: a click must not mint an anonymous user and a
// workspace for someone who is only on their way to Stripe.
export async function GET(request: Request): Promise<Response> {
    if (!BILLING_ENABLED) return new Response(null, { status: 404 })
    const from = new URL(request.url).searchParams.get('from') ?? ''
    const cancelUrl = landingUrl(LANDING_PATH.test(from) ? from : '/')
    return Response.redirect(await createLifetimeCheckoutUrl(cancelUrl), 303)
}
