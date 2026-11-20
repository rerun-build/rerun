import { Agent as UndiciAgent } from 'undici'
import { refusalMessageOf, refusalResponse } from '../lib/refusal-body.js'

const CUSTOM_ENDPOINT_PATIENCE_MS = 60 * 60_000
const customEndpointDispatcher = new UndiciAgent({ headersTimeout: CUSTOM_ENDPOINT_PATIENCE_MS, bodyTimeout: CUSTOM_ENDPOINT_PATIENCE_MS })

export function customEndpointFetch(inner: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
        const response = await inner(input, { ...init, dispatcher: customEndpointDispatcher } as RequestInit)
        if (response.status !== 402) return response
        const text = await response.text()
        const reason = refusalMessageOf(text) || response.statusText || 'Payment Required'
        return refusalResponse(response, text, `Provider returned error: ${reason}`, 'custom')
    }
}
