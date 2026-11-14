export const BUDGET_EXHAUSTED_EVENT = 'workspace.budget.exhausted'
export const RERUN_BUDGET_ERROR_CODE = 'rerun_budget_exhausted'
export const BUDGET_NOTICE_WINDOW_MS = 24 * 60 * 60_000

export type BudgetNoticeDecision = { insert: boolean; email: boolean }

export function decideBudgetNotice({ recentNoticeExists, isSandbox }: { recentNoticeExists: boolean; isSandbox: boolean }): BudgetNoticeDecision {
    const insert = !recentNoticeExists
    return { insert, email: insert && !isSandbox }
}

export const ENGINE_RESTARTED_ERROR_CODE = 'engine_restarted'

const EMAIL_SUPPRESSING_CODES = new Set([RERUN_BUDGET_ERROR_CODE, ENGINE_RESTARTED_ERROR_CODE])

export function suppressesErrorEmail(kind: string, metadata: Record<string, unknown> | null | undefined): boolean {
    return kind === 'error' && typeof metadata?.errorCode === 'string' && EMAIL_SUPPRESSING_CODES.has(metadata.errorCode)
}
