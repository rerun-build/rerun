// lib/billing/stripe.ts builds its client and reads the add-on price ids the moment it is imported,
// and Stripe refuses to construct without a key. Most of the server code imports it transitively, so
// without these a test of anything near billing fails at import time rather than on an assertion.
// The client is never reached: tests that go near it replace `stripe` with test/stripe-fake.ts.
process.env.STRIPE_SECRET_KEY ??= 'sk_test_vitest'
process.env.STRIPE_PRICE_BASE ??= 'price_base'
process.env.STRIPE_PRICE_BASE_LEGACY ??= 'price_base_legacy'
process.env.STRIPE_PRICE_AGENT_PACK ??= 'price_agent_pack'
process.env.STRIPE_PRICE_SEAT ??= 'price_seat'
process.env.STRIPE_PRICE_CREDIT_PACK ??= 'price_credit_pack'
process.env.STRIPE_PRICE_BASE_YEARLY ??= 'price_base_yearly'
process.env.STRIPE_PRICE_AGENT_PACK_YEARLY ??= 'price_agent_pack_yearly'
process.env.STRIPE_PRICE_CREDIT_PACK_YEARLY ??= 'price_credit_pack_yearly'
process.env.STRIPE_PRICE_CREDIT_ONCE ??= 'price_credit_once'
process.env.STRIPE_PRICE_LINKEDIN_SLOT ??= 'price_linkedin_slot'
process.env.STRIPE_PRICE_LINKEDIN_SLOT_YEARLY ??= 'price_linkedin_slot_yearly'
process.env.STRIPE_PRICE_WHATSAPP_SLOT ??= 'price_whatsapp_slot'
process.env.STRIPE_PRICE_WHATSAPP_SLOT_YEARLY ??= 'price_whatsapp_slot_yearly'
process.env.STRIPE_PRICE_BASE_29 ??= 'price_base_29'
process.env.STRIPE_PRICE_BASE_29_YEARLY ??= 'price_base_29_yearly'
