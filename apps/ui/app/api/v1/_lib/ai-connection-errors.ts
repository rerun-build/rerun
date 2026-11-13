import { ConnectionInputError } from '@/app/api/_services/ai-connection.service'
import { NoPlanError } from '@/app/api/_services/capacity.service'
import { ApiError } from '@/app/api/v1/_lib/api-route'
import { EngineRequestError } from '@/lib/engine/client'

// What the AI providers routes owe the app beyond a bare 500: a credential refused for a reason the
// user can act on, a connection the machine does not have. The
// app never shows a price, so a missing plan carries a reason rather than a pitch.
export async function answeringConnectionErrors<T>(work: () => Promise<T>): Promise<T | Response> {
    try {
        return await work()
    } catch (err) {
        if (err instanceof ConnectionInputError) throw new ApiError(400, err.message)
        if (err instanceof NoPlanError) return Response.json({ error: 'This workspace has no active plan.', reason: 'no_plan' }, { status: 403 })
        if (err instanceof EngineRequestError && err.status === 404) throw new ApiError(404, 'This provider is not on the machine anymore.')
        if (err instanceof EngineRequestError && err.status >= 400 && err.status < 500) throw new ApiError(400, 'The machine refused this change.')
        throw err
    }
}

// A sign-in step that fails speaks for the provider (an expired code, a code from another tab).
export async function signInStep<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work()
    } catch (err) {
        throw new ApiError(400, err instanceof Error ? err.message : 'The sign-in did not go through.')
    }
}
