import { ConnectionInputError } from '@/app/api/_services/ai-connection.service'
import { NoPlanError } from '@/app/api/_services/capacity.service'
import { ModelNotEntitledError } from '@/app/api/_services/engine-plan.service'
import { ApiError } from '@/app/api/v1/_lib/api-route'
import { EngineRequestError } from '@/lib/engine/client'

export async function answeringConnectionErrors<T>(work: () => Promise<T>): Promise<T | Response> {
    try {
        return await work()
    } catch (err) {
        if (err instanceof ConnectionInputError) throw new ApiError(400, err.message)
        if (err instanceof ModelNotEntitledError) throw new ApiError(403, 'This model is not included in your plan.')
        if (err instanceof NoPlanError) return Response.json({ error: 'This workspace has no active plan.', reason: 'no_plan' }, { status: 403 })
        if (err instanceof EngineRequestError && err.status === 404) throw new ApiError(404, 'This provider is not on the machine anymore.')
        if (err instanceof EngineRequestError && err.status >= 400 && err.status < 500) throw new ApiError(400, 'The machine refused this change.')
        throw err
    }
}

export async function signInStep<T>(work: () => Promise<T>): Promise<T> {
    try {
        return await work()
    } catch (err) {
        throw new ApiError(400, err instanceof Error ? err.message : 'The sign-in did not go through.')
    }
}
