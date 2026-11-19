import type { ErrorCode, ErrorParams } from '@/lib/i18n/action-error'

// What a route refuses with: the English text, and the code of the `errors` namespace the app
// translates when it has one.
export type ApiRefusal = { error: string; code?: ErrorCode; params?: ErrorParams }

// An error a route turns into a response with its own status, rather than a 500.
export class ApiError extends Error {
    readonly code?: ErrorCode
    readonly params?: ErrorParams

    constructor(
        readonly status: number,
        refusal: string | ApiRefusal
    ) {
        super(typeof refusal === 'string' ? refusal : refusal.error)
        if (typeof refusal !== 'string') {
            this.code = refusal.code
            this.params = refusal.params
        }
        this.name = 'ApiError'
    }
}
