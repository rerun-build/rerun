import type { createOpenAI } from '@ai-sdk/openai'
import { withAnthropicCacheBreakpoints, type ChatBody } from '@rerun/contracts'

type FetchFunction = NonNullable<NonNullable<Parameters<typeof createOpenAI>[0]>['fetch']>

export function cacheBreakpointsFetch(inner: FetchFunction): FetchFunction {
    return async (input, init) => {
        if (typeof init?.body !== 'string') return inner(input, init)
        let body: ChatBody
        try {
            body = JSON.parse(init.body) as ChatBody
        } catch {
            return inner(input, init)
        }
        if (typeof body.model !== 'string' || !body.model.startsWith('anthropic/')) return inner(input, init)
        return inner(input, { ...init, body: JSON.stringify({ ...withAnthropicCacheBreakpoints(body), provider: { order: ['anthropic'], ...(body.provider as object | undefined) } }) })
    }
}
