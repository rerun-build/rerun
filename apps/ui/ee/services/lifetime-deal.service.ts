import 'server-only'

import { createHmac } from 'node:crypto'
import { isLocale } from '@rerun/i18n'
import type Stripe from 'stripe'
import type { Database } from '@/app/api/database.types'
import { sendLifetimeCodeEmail } from '@/app/api/_services/email.service'
import { getAppOrigin } from '@/lib/app-origin'
import { requestLocale } from '@/lib/i18n/request-locale'
import { landingUrl } from '@/lib/site'
import { affiliateReferralMetadata } from '@/ee/lib/billing/affiliate'
import { LIFETIME_PURCHASE_CONSENT } from '@/ee/lib/billing/consent'
import { LIFETIME_PLAN_SLUG } from '@/ee/lib/billing/plans'
import { idOf, lifetimePriceId, stripe } from '@/ee/lib/billing/stripe'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

type CodeInsert = Database['public']['Tables']['invitation_codes']['Insert']
type CodeUpdate = Database['public']['Tables']['invitation_codes']['Update']

// The lifetime plan sold on rerun.build/lifetime, without AppSumo in between. The payment buys the
// same one-use code AppSumo hands out, redeemed on the same /redeem page.
export const LIFETIME_DEAL_KIND = 'lifetime_deal'

export async function createLifetimeCheckoutUrl(): Promise<string> {
    const origin = await getAppOrigin()
    // The locale travels with the payment: the webhook that emails the code has no browser to read it from.
    const metadata: Stripe.MetadataParam = { kind: LIFETIME_DEAL_KIND, locale: await requestLocale(), ...(await affiliateReferralMetadata()) }

    const checkout = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ price: lifetimePriceId(), quantity: 1 }],
        // Card only: a delayed method completes the session as `unpaid`, and the code is only shown
        // for a session that is `paid`.
        payment_method_types: ['card'],
        customer_creation: 'always',
        automatic_tax: { enabled: true },
        tax_id_collection: { enabled: true },
        invoice_creation: { enabled: true, invoice_data: { metadata } },
        payment_intent_data: { metadata },
        ...LIFETIME_PURCHASE_CONSENT,
        metadata,
        // {CHECKOUT_SESSION_ID} is a Stripe literal, not a template hole to interpolate.
        success_url: `${origin}/redeem?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: landingUrl('/lifetime'),
    })
    if (!checkout.url) throw new Error('Stripe did not return a checkout URL')
    return checkout.url
}

// No I nor O, so a code read out of an email is never mistyped as 1 or 0. 32 symbols, 5 bits each.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CODE_GROUPS = 3
const CODE_GROUP_LENGTH = 4

// Derived from the Checkout Session instead of drawn at random: reloading the page after the
// payment gives back the same code, so a session never mints a second one.
export function lifetimeCodeOf(sessionId: string): string {
    const digest = createHmac('sha256', process.env.STRIPE_SECRET_KEY ?? '').update(`${LIFETIME_DEAL_KIND}:${sessionId}`).digest()
    const symbols = Array.from(digest.subarray(0, CODE_GROUPS * CODE_GROUP_LENGTH), byte => CODE_ALPHABET[byte % CODE_ALPHABET.length])
    const groups = Array.from({ length: CODE_GROUPS }, (_, i) => symbols.slice(i * CODE_GROUP_LENGTH, (i + 1) * CODE_GROUP_LENGTH).join(''))
    return ['RERUN', ...groups].join('-')
}

export function isLifetimeCheckoutSession(session: Stripe.Checkout.Session): boolean {
    return session.metadata?.kind === LIFETIME_DEAL_KIND
}

async function paidLifetimeSession(sessionId: string): Promise<Stripe.Checkout.Session | null> {
    if (!sessionId.startsWith('cs_')) return null
    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId)
        return isLifetimeCheckoutSession(session) && session.payment_status === 'paid' ? session : null
    } catch (err) {
        if ((err as { code?: string }).code === 'resource_missing') return null
        throw err
    }
}

// Written by whichever comes first, the buyer's browser back from Checkout or the webhook: the
// second one finds the row and leaves it as it is.
async function saveLifetimeCode(session: Stripe.Checkout.Session): Promise<string> {
    const code = lifetimeCodeOf(session.id)
    const email = session.customer_details?.email
    const note = `Bought on rerun.build${email ? ` by ${email}` : ''} (${session.id})`
    const { error } = await createServiceRoleClient()
        .from('invitation_codes')
        .upsert<CodeInsert>({ code, plan: LIFETIME_PLAN_SLUG, max_uses: 1, note, created_by: 'stripe' }, { onConflict: 'code', ignoreDuplicates: true })
    if (error) throw new Error(`Could not save the lifetime code: ${error.message}`)
    return code
}

// The code of a paid lifetime Checkout Session, for the page the buyer lands on, or null when the
// session is not one. It only shows the code: the email is the webhook's, below.
export async function lifetimeCodeForCheckout(sessionId: string): Promise<string | null> {
    const session = await paidLifetimeSession(sessionId)
    return session ? saveLifetimeCode(session) : null
}

// `checkout.session.completed`: the code reaches the buyer even when the tab was closed before the
// page above ran. A failed email throws, so Stripe delivers the event again and the email with it.
export async function deliverLifetimeCheckout(session: Stripe.Checkout.Session): Promise<void> {
    if (session.payment_status !== 'paid') return
    const code = await saveLifetimeCode(session)
    const email = session.customer_details?.email
    if (!email) return

    const locale = session.metadata?.locale
    const sent = await sendLifetimeCodeEmail({ to: email, code, locale: isLocale(locale) ? locale : undefined })
    if (!sent.ok) throw new Error(`Could not email the lifetime code of ${session.id}: ${sent.error}`)
}

// `charge.refunded`: a deal refunded in full takes its code back. A workspace that already redeemed
// it keeps the lifetime plan: taking a plan away from a customer is support's call, so it is only
// logged. A partial refund is a gesture, and changes nothing.
export async function refundLifetimePurchase(charge: Stripe.Charge): Promise<void> {
    if (charge.metadata?.kind !== LIFETIME_DEAL_KIND || charge.amount_refunded < charge.amount) return
    const intentId = idOf(charge.payment_intent)
    if (!intentId) return
    const [session] = (await stripe.checkout.sessions.list({ payment_intent: intentId, limit: 1 })).data
    if (!session) return

    const supabase = createServiceRoleClient()
    const { data: revoked, error } = await supabase.from('invitation_codes').update<CodeUpdate>({ active: false }).eq('code', lifetimeCodeOf(session.id)).select('id, uses')
    if (error) throw new Error(`Could not revoke the lifetime code refunded: ${error.message}`)

    const code = revoked?.[0]
    if (!code?.uses) return
    const { data: redemption } = await selectMaybeSingle(supabase, 'invitation_redemptions', ['workspace_id'] as const, { code_id: code.id })
    console.error('[lifetime deal] refunded after its code was redeemed, the workspace keeps the lifetime plan', { session: session.id, workspaceId: redemption?.workspace_id ?? null })
}
