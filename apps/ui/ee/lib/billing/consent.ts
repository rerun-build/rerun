import type Stripe from 'stripe'

// A buyer who is not acting professionally keeps a 14 day withdrawal right on a distance contract,
// and both of the things Rerun sells are performed immediately: the subscription starts on the spot
// and a template lands in the workspace the moment the charge succeeds. The right only falls away if
// the buyer expressly asks for that immediate performance and acknowledges what it costs them, so
// the acknowledgement has to be collected before the payment, not written in the Terms alone.
//
// Stripe records the acceptance against the session, which is the evidence a dispute actually turns
// on. See /terms section 7 and /refunds section 8.
//
// Requires a Terms of Service URL in Settings > Checkout and Payment Links, in both test and live
// mode: without it Stripe rejects `consent_collection` and no session is created at all.
//
// The plan is sold through the app-rendered Checkout, which refuses `custom_text`: its acknowledgement
// is the billing dialog's own checkbox (TermsConsent), recorded on the session by acceptPlanTerms.

const IMMEDIATE_DELIVERY_NOTICE =
    'The template is delivered to your workspace as soon as the payment succeeds. By continuing you ask for that immediate delivery and, if you are a consumer, you accept that your right of withdrawal ends with it. Purchases are not refundable.'

export const TEMPLATE_PURCHASE_CONSENT: Pick<Stripe.Checkout.SessionCreateParams, 'consent_collection' | 'custom_text'> = {
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: IMMEDIATE_DELIVERY_NOTICE } },
}

const IMMEDIATE_CREDIT_NOTICE =
    'The Rerun credit is added to your workspace as soon as the payment succeeds, and never expires. By continuing you ask for that immediate delivery and, if you are a consumer, you accept that your right of withdrawal ends with it.'

export const CREDIT_PURCHASE_CONSENT: Pick<Stripe.Checkout.SessionCreateParams, 'consent_collection' | 'custom_text'> = {
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: IMMEDIATE_CREDIT_NOTICE } },
}

// Selling carries obligations a buyer never signs up to (clawback on a refund, the cost of a
// chargeback, tax duties), so the creator contract is accepted separately from the Terms. The date
// is the version: bump it when /marketplace-terms changes materially, and every creator reaccepts on
// their next trip through Stripe onboarding.
export const CREATOR_TERMS_VERSION = '2026-08-13'

// Recorded on the connected account rather than in our database: it belongs with the rest of the
// evidence Stripe already holds on that account, and it survives a workspace being deleted.
export function creatorTermsMetadata(): Stripe.MetadataParam {
    return { creator_terms_version: CREATOR_TERMS_VERSION, creator_terms_accepted_at: new Date().toISOString() }
}
