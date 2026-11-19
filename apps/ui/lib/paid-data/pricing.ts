import { PAID_DATA_DEFAULT_PRICE_MULTIPLIER } from '@moldwright/contracts'

export function paidDataPriceMultiplier(): number {
    const value = Number(process.env.PAID_DATA_PRICE_MULTIPLIER)
    return Number.isFinite(value) && value > 0 ? value : PAID_DATA_DEFAULT_PRICE_MULTIPLIER
}

export function billedMicros(providerCostMicros: number): number {
    return Math.round(providerCostMicros * paidDataPriceMultiplier())
}
