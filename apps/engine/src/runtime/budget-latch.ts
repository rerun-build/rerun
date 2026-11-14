import { APICallError } from 'ai'

const LATCH_MS = 10 * 60_000

let latchedUntil = 0

export const RERUN_BUDGET_ERROR_CODE = 'rerun_budget_exhausted'

export function armBudgetLatch(now = Date.now()): void {
    latchedUntil = now + LATCH_MS
}

export function clearBudgetLatch(): void {
    latchedUntil = 0
}

export function isBudgetLatched(now = Date.now()): boolean {
    return now < latchedUntil
}

export function isRerunBudgetError(error: unknown): boolean {
    if (APICallError.isInstance(error)) {
        if (error.statusCode === 402) return true
        if (typeof error.responseBody === 'string' && error.responseBody.includes(RERUN_BUDGET_ERROR_CODE)) return true
    }
    return String(error).includes(RERUN_BUDGET_ERROR_CODE)
}
