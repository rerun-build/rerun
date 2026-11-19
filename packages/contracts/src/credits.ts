export const CREDITS_PER_USD = 100

export const MICROS_PER_CREDIT = 10_000

export const creditsFromUsd = (usd: number) => Math.round(usd * CREDITS_PER_USD)

export const creditsFromMicros = (micros: number) => Math.round(micros / MICROS_PER_CREDIT)

export type HubMoldwrightCredit = { remainingMicros: number; usedMicros: number; totalMicros: number; paused: boolean; resetsAt: string | null }

export function formatCredits(micros: number, locale = 'en'): string {
    const value = micros / MICROS_PER_CREDIT
    if (value > 0 && value < 1) return '<1'
    return Math.round(value).toLocaleString(locale === 'en' ? 'en-US' : locale)
}

export function creditsLabel(credits: number): string {
    return `${credits.toLocaleString('en-US')} ${credits === 1 ? 'credit' : 'credits'}`
}

export function formatCreditsLabel(micros: number): string {
    const figure = formatCredits(micros)
    return `${figure} ${figure === '1' || figure === '<1' ? 'credit' : 'credits'}`
}
