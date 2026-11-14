import type Stripe from 'stripe'

const IMMEDIATE_DELIVERY_NOTICE =
    'The template is delivered to your workspace as soon as the payment succeeds. By continuing you ask for that immediate delivery and, if you are a consumer, you accept that your right of withdrawal ends with it. Purchases are not refundable.'

export const TEMPLATE_PURCHASE_CONSENT: Pick<Stripe.Checkout.SessionCreateParams, 'consent_collection' | 'custom_text'> = {
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: IMMEDIATE_DELIVERY_NOTICE } },
}

export const CREATOR_TERMS_VERSION = '2026-08-13'

export function creatorTermsMetadata(): Stripe.MetadataParam {
    return { creator_terms_version: CREATOR_TERMS_VERSION, creator_terms_accepted_at: new Date().toISOString() }
}
