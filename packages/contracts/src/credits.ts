// The user never sees the Rerun credit in dollars: one dollar of it is 100 credits. The ledger stays
// in micro-dollars (`rerun_*_micros`, `billed_micros`) and the plan constants in whole dollars; only
// what is shown is converted, here.
export const CREDITS_PER_USD = 100

export const MICROS_PER_CREDIT = 10_000

export const creditsFromUsd = (usd: number) => Math.round(usd * CREDITS_PER_USD)

export const creditsFromMicros = (micros: number) => Math.round(micros / MICROS_PER_CREDIT)

// What the hub answers to a coworker's `rerun_credit` call: the ledger in micro-dollars, converted
// to credits by the engine before the coworker reads it.
export type HubRerunCredit = { remainingMicros: number; usedMicros: number; totalMicros: number; paused: boolean; resetsAt: string | null }

// A balance or a cost as a bare figure, "1,250". A cost under one credit reads "<1" rather than "0",
// so a paid call never looks free.
// `locale` only changes the digit grouping ("1,250", "1 250", "1.250"); the word "credits" goes
// through the app's translations.
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
