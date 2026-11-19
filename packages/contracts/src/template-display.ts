import type { TemplateStoryStep } from './template.js'

export const TEMPLATE_CATEGORIES = ['agencies', 'ecommerce', 'saas', 'sales', 'recruiting', 'real-estate', 'legal', 'creators', 'productivity', 'other'] as const
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

export type TemplateCategoryCopy = (key: TemplateCategory) => string

export function templateCategoryLabel(category: string, t: TemplateCategoryCopy): string {
    return t((TEMPLATE_CATEGORIES as readonly string[]).includes(category) ? (category as TemplateCategory) : 'other')
}

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

export const TEMPLATE_STATUSES = ['draft', 'in_review', 'published', 'unlisted', 'archived'] as const
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number]

export const PUBLIC_TEMPLATE_STATUSES = ['published', 'unlisted'] as const
export function isPublicStatus(status: TemplateStatus): boolean {
    return status === 'published' || status === 'unlisted'
}

export const TEMPLATE_PRICING_MODELS = ['free', 'one_time', 'recurring'] as const
export type TemplatePricingModel = (typeof TEMPLATE_PRICING_MODELS)[number]

export const MIN_TEMPLATE_PRICE_CENTS = 500
export const MAX_TEMPLATE_PRICE_CENTS = 200_000
export const TEMPLATE_CURRENCY = 'usd'
export const TEMPLATE_TITLE_MAX_LENGTH = 50

export const SEO_DESCRIPTION_MIN_LENGTH = 120
export const SEO_DESCRIPTION_MAX_LENGTH = 155

export function isSeoDescriptionLength(text: string): boolean {
    const length = text.trim().length
    return length >= SEO_DESCRIPTION_MIN_LENGTH && length <= SEO_DESCRIPTION_MAX_LENGTH
}

export const TEMPLATE_STORY_MAX_STEPS = 8
export const TEMPLATE_STORY_STATUSES = ['working', 'waiting_human', 'idle'] as const
export const TEMPLATE_STORY_CAMERAS = ['wide', 'agent'] as const
export const TEMPLATE_STORY_ARTIFACT_TONES = ['neutral', 'approval', 'success'] as const
export const TEMPLATE_STORY_MAX_ACTIONS = 6

const STORY_BEAT_MS = 1100
export const STORY_CARD_ENTER_MS = 700
export const STORY_ACTION_MS = STORY_BEAT_MS
export const STORY_RESULT_HOLD_MS = 2 * STORY_BEAT_MS

export function storyStepDurationMs(step: Pick<TemplateStoryStep, 'actions'>): number {
    return STORY_CARD_ENTER_MS + step.actions.length * STORY_ACTION_MS + STORY_RESULT_HOLD_MS
}

export const TEMPLATE_STORY_MIN_STEPS = 2

export function playableStory(story: readonly TemplateStoryStep[], agentKeys: readonly string[]): TemplateStoryStep[] {
    const keys = new Set(agentKeys)
    const steps = story.filter(step => keys.has(step.agentKey))
    return steps.length >= TEMPLATE_STORY_MIN_STEPS ? steps : []
}

export type TemplatePricing = { model: TemplatePricingModel; amountCents: number; currency: string }

export function isPaid(pricing: TemplatePricing): boolean {
    return pricing.model !== 'free' && pricing.amountCents > 0
}

export const AMOUNT_LOCALE = 'en-US'

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

export function templateCardCtaLabel(pricing: TemplatePricing, t: TemplatePriceCopy, locale: string): string {
    return isPaid(pricing) ? t('hireCard', { price: priceLabel(pricing, t, locale) }) : t('useForFree')
}

export const MARKETPLACE_FEE_PERCENT = 5
export const MARKETPLACE_FEE_FIXED_CENTS = 30

export function moldwrightFeeCents(netOfTaxCents: number): number {
    if (netOfTaxCents <= 0) return 0
    const fee = Math.round((netOfTaxCents * MARKETPLACE_FEE_PERCENT) / 100) + MARKETPLACE_FEE_FIXED_CENTS
    return Math.min(fee, netOfTaxCents)
}

export function creatorNetCents(netOfTaxCents: number): number {
    return Math.max(0, netOfTaxCents - moldwrightFeeCents(netOfTaxCents))
}

export function marketplaceFeeLabel(currency: string = TEMPLATE_CURRENCY): string {
    return `${MARKETPLACE_FEE_PERCENT}% + ${formatAmount(MARKETPLACE_FEE_FIXED_CENTS, currency)}`
}

export type SaleSplit = { taxCents: number; feeCents: number; netCents: number }

export function splitSale(grossCents: number, taxCents: number): SaleSplit {
    const netOfTax = Math.max(0, grossCents - taxCents)
    const feeCents = moldwrightFeeCents(netOfTax)
    return { taxCents, feeCents, netCents: netOfTax - feeCents }
}
