import { Agent as UndiciAgent } from 'undici'
import { refusalMessageOf, refusalResponse } from '../lib/refusal-body.js'

// A local model on modest hardware reads a long prompt for minutes before its first token, and
// sends no response header until then: past the five minutes Node allows, the request is dropped and
// retried from scratch, three times over. Measured on a CPU box: a 20k-token prompt takes 25 minutes.
const CUSTOM_ENDPOINT_PATIENCE_MS = 60 * 60_000
const customEndpointDispatcher = new UndiciAgent({ headersTimeout: CUSTOM_ENDPOINT_PATIENCE_MS, bodyTimeout: CUSTOM_ENDPOINT_PATIENCE_MS })

// xAI answers a spent account with `{ error: "<sentence>" }`, which the OpenAI SDK skips for the bare
// "Payment Required", and the chat reads that as Rerun credits used up. What a 402 means is up to
// each server, so it is kept as the provider's own refusal, in its own words.
export function customEndpointFetch(inner: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
        const response = await inner(input, { ...init, dispatcher: customEndpointDispatcher } as RequestInit)
        if (response.status !== 402) return response
        const text = await response.text()
        const reason = refusalMessageOf(text) || response.statusText || 'Payment Required'
        return refusalResponse(response, text, `Provider returned error: ${reason}`, 'custom')
    }
}
