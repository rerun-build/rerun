// The part of the template contract that carries no schema: labels, limits, story timing and
// price formatting. Kept free of zod so a page that only shows a category or a price does not ship
// the validation library with it.
import type { TemplateStoryStep } from './template.js'

// The audience a template is built for, not the internal team that would own the work: the
// public library is browsed by people looking for their own line of business.
export const TEMPLATE_CATEGORIES = ['agencies', 'ecommerce', 'saas', 'sales', 'recruiting', 'real-estate', 'legal', 'creators', 'productivity', 'other'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

// The `templates.categories` catalog: several slugs do not title case into anything readable
// ("Saas", "Real-estate"), so each category is named once there.
export type TemplateCategoryCopy = (key: TemplateCategory) => string

export function templateCategoryLabel(category: string, t: TemplateCategoryCopy): string {
    return t((TEMPLATE_CATEGORIES as readonly string[]).includes(category) ? (category as TemplateCategory) : 'other')
}

// What each category promises, in one line. Written next to the labels because both surfaces that
// name a category (the landing's Templates menu, the library's shelves) say the same thing about
// it, and a category added to the contract must not compile until someone writes its line.
export const TEMPLATE_CATEGORY_TAGLINES: Record<TemplateCategory, string> = {
    agencies: 'The delivery work you repeat on every account.',
    ecommerce: 'Watch your store, your orders and your market.',
    saas: 'Issue triage, payment health and weekly signal.',
    sales: 'Research prospects and keep the pipeline warm.',
    recruiting: 'Screen applications and hand you a shortlist.',
    'real-estate': 'Source sellers, price deals, post your market.',
    legal: 'Read contracts and rate the risk before the audit.',
    creators: 'Keep the publishing calendar full every week.',
    productivity: 'Inbox, meeting notes, invoices and recaps.',
    other: 'Templates that solve one very specific problem.',
}

// `in_review` is a draft its author has handed to the Rerun team: still private, but frozen on
// their side until we publish it or send it back.
export const TEMPLATE_STATUSES = ['draft', 'in_review', 'published', 'unlisted', 'archived'] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

// An unlisted template has a public page reachable by URL but appears in no listing, so it
// carries the same editorial requirements as a published one.
export const PUBLIC_TEMPLATE_STATUSES = ['published', 'unlisted'] as const
export function isPublicStatus(status: TemplateStatus): boolean {
    return status === 'published' || status === 'unlisted'
}

// A template is sold by its author, who picks one of three models. `recurring` is monthly: access
// lasts as long as the subscription does, which is the only model where a template can be taken
// back from a workspace that already installed it.
export const TEMPLATE_PRICING_MODELS = ['free', 'one_time', 'recurring'] as const
export type TemplatePricingModel = (typeof TEMPLATE_PRICING_MODELS)[number]

// The product floor. The DB constraint sits lower on purpose: it is the last line of defence,
// this is the rule.
export const MIN_TEMPLATE_PRICE_CENTS = 500
export const MAX_TEMPLATE_PRICE_CENTS = 200_000
export const TEMPLATE_CURRENCY = 'usd'
export const TEMPLATE_TITLE_MAX_LENGTH = 50

// The band a search result snippet has to sit in: shorter and Google writes its own, longer and it
// is cut mid-sentence. One definition, read by the public pages and by every editor that feeds them.
export const SEO_DESCRIPTION_MIN_LENGTH = 120
export const SEO_DESCRIPTION_MAX_LENGTH = 155

export function isSeoDescriptionLength(text: string): boolean {
    const length = text.trim().length
    return length >= SEO_DESCRIPTION_MIN_LENGTH && length <= SEO_DESCRIPTION_MAX_LENGTH
}

// A story is the scripted walk through the board on the template's public page: each step lights
// what one agent is doing, frames it, and says it in a caption. References to agents and tools are
// plain strings on purpose: a re-capture that renames an agent must not make the whole template
// unsavable, so the player drops the steps it can no longer stage instead.
export const TEMPLATE_STORY_MAX_STEPS = 8
export const TEMPLATE_STORY_STATUSES = ['working', 'waiting_human', 'idle'] as const
export const TEMPLATE_STORY_CAMERAS = ['wide', 'agent'] as const
export const TEMPLATE_STORY_ARTIFACT_TONES = ['neutral', 'approval', 'success'] as const
export const TEMPLATE_STORY_MAX_ACTIONS = 6

// One pace for the whole story, so no step drags and none rushes: every action gets one beat on the
// card, and what a step ends on (its result, or the step itself when it has no actions) gets two.
// The card only starts counting once the camera has landed and it has come in.
const STORY_BEAT_MS = 1100
export const STORY_CARD_ENTER_MS = 700
export const STORY_ACTION_MS = STORY_BEAT_MS
export const STORY_RESULT_HOLD_MS = 2 * STORY_BEAT_MS

// A step lasts exactly what its card needs to tell its actions and hold its result. There is no
// authored duration on purpose: a hand-set one is what made a close-up linger while the next step
// rushed. A duration stored before that is dropped on parse.
export function storyStepDurationMs(step: Pick<TemplateStoryStep, 'actions'>): number {
    return STORY_CARD_ENTER_MS + step.actions.length * STORY_ACTION_MS + STORY_RESULT_HOLD_MS
}

// Under two steps there is nothing to tell, and the page keeps the free-running board instead.
export const TEMPLATE_STORY_MIN_STEPS = 2

// The steps a board can still stage: one whose agent left the template (a re-capture renamed it) is
// dropped, so a stale story degrades to a shorter one rather than to a step pointing at nothing.
export function playableStory(story: readonly TemplateStoryStep[], agentKeys: readonly string[]): TemplateStoryStep[] {
    const keys = new Set(agentKeys)
    const steps = story.filter(step => keys.has(step.agentKey))
    return steps.length >= TEMPLATE_STORY_MIN_STEPS ? steps : []
}

// What a template costs, as every surface reads it. Kept apart from the document so a card, a
// landing page or a checkout can carry a price without carrying the whole editorial page.
export type TemplatePricing = { model: TemplatePricingModel; amountCents: number; currency: string }

export function isPaid(pricing: TemplatePricing): boolean {
    return pricing.model !== 'free' && pricing.amountCents > 0
}

export const AMOUNT_LOCALE = 'en-US'

// Whole dollars stay whole: $29, not $29.00. A price with cents is rare enough that showing them
// only when they exist reads better on a card than padding every amount.
//
// Exposed as options rather than only as a string because an animated amount (NumberFlow) formats
// the number itself, and it has to land on the exact same glyphs as the server-rendered string.
// Deliberately narrower than `Intl.NumberFormatOptions`: NumberFlow only accepts a subset of the
// Intl options, and the wide type is not assignable to it.
export type AmountFormat = { style: 'currency'; currency: string; minimumFractionDigits: number; maximumFractionDigits: number }

export function amountFormat(cents: number, currency: string = TEMPLATE_CURRENCY): AmountFormat {
    const hasCents = cents % 100 !== 0
    return {
        style: 'currency',
        currency: currency.toUpperCase(),
        minimumFractionDigits: hasCents ? 2 : 0,
        maximumFractionDigits: hasCents ? 2 : 0,
    }
}

export function formatAmount(cents: number, currency: string = TEMPLATE_CURRENCY, locale: string = AMOUNT_LOCALE): string {
    return new Intl.NumberFormat(locale, amountFormat(cents, currency)).format(cents / 100)
}

// The `templates.price` catalog, or the landing's copy of it.
export type TemplatePriceCopy = (key: 'free' | 'monthly' | 'useForFree' | 'hire' | 'hireCard', values?: Record<string, string | number>) => string

export function priceLabel(pricing: TemplatePricing, t: TemplatePriceCopy, locale: string): string {
    if (!isPaid(pricing)) return t('free')
    const amount = formatAmount(pricing.amountCents, pricing.currency, locale)
    return pricing.model === 'recurring' ? t('monthly', { amount }) : amount
}

export function priceCtaLabel(pricing: TemplatePricing, agentCount: number, t: TemplatePriceCopy, locale: string): string {
    if (!isPaid(pricing)) return t('useForFree')
    return t('hire', { count: Math.max(agentCount, 1), price: priceLabel(pricing, t, locale) })
}

// The label a card reveals under the cursor, where the price it replaces already said the amount.
// Shorter than priceCtaLabel, which stands alone at the bottom of a detail page and has to name
// who is being hired, not just what it costs. Kept short: a longer label starts squeezing the meta
// line beside it on a narrow card.
export function templateCardCtaLabel(pricing: TemplatePricing, t: TemplatePriceCopy, locale: string): string {
    return isPaid(pricing) ? t('hireCard', { price: priceLabel(pricing, t, locale) }) : t('useForFree')
}

// What Rerun keeps on a sale. Plain constants rather than env vars: the creator UI quotes the
// figures back to the author before they price anything, so the browser has to know them too, and a
// number that differs between the two would be worse than one that needs a deploy to change.
// The fixed part is what makes the fee cover Stripe's own per-transaction cost on small sales.
export const MARKETPLACE_FEE_PERCENT = 5
export const MARKETPLACE_FEE_FIXED_CENTS = 30

// Every figure here is computed on the amount left once the tax Rerun owes has been taken out of
// the charge, never on the total the buyer paid.
export function rerunFeeCents(netOfTaxCents: number): number {
    if (netOfTaxCents <= 0) return 0
    const fee = Math.round((netOfTaxCents * MARKETPLACE_FEE_PERCENT) / 100) + MARKETPLACE_FEE_FIXED_CENTS
    return Math.min(fee, netOfTaxCents)
}

export function creatorNetCents(netOfTaxCents: number): number {
    return Math.max(0, netOfTaxCents - rerunFeeCents(netOfTaxCents))
}

export function marketplaceFeeLabel(currency: string = TEMPLATE_CURRENCY): string {
    return `${MARKETPLACE_FEE_PERCENT}% + ${formatAmount(MARKETPLACE_FEE_FIXED_CENTS, currency)}`
}

// How one paid amount divides into the tax Rerun owes, the fee it keeps, and what the creator gets.
export type SaleSplit = { taxCents: number; feeCents: number; netCents: number }

export function splitSale(grossCents: number, taxCents: number): SaleSplit {
    const netOfTax = Math.max(0, grossCents - taxCents)
    const feeCents = rerunFeeCents(netOfTax)
    return { taxCents, feeCents, netCents: netOfTax - feeCents }
}
