import { CUSTOM_ENDPOINT_REFUSED } from '@rerun/contracts'
import { Agent as UndiciAgent } from 'undici'
import { refusalMessageOf, refusalResponse } from '../lib/refusal-body.js'

// A local model on modest hardware reads a long prompt for minutes before its first token, and
// sends no response header until then: past the five minutes Node allows, the request is dropped and
// retried from scratch, three times over. Measured on a CPU box: a 20k-token prompt takes 25 minutes.
const CUSTOM_ENDPOINT_PATIENCE_MS = 60 * 60_000
const customEndpointDispatcher = new UndiciAgent({ headersTimeout: CUSTOM_ENDPOINT_PATIENCE_MS, bodyTimeout: CUSTOM_ENDPOINT_PATIENCE_MS })

// A proxy or a host in front of the endpoint can answer its 402 with a whole page: only a sentence is
// worth keeping as the reason.
const REASON_MAX_LENGTH = 500

function reasonOf(text: string, statusText: string): string {
    const reason = refusalMessageOf(text)
    if (!reason || reason.startsWith('<')) return statusText || 'Payment Required'
    return reason.length > REASON_MAX_LENGTH ? `${reason.slice(0, REASON_MAX_LENGTH)}…` : reason
}

// xAI answers a spent account with `{ error: "<sentence>" }`, which the OpenAI SDK skips for the bare
// "Payment Required", and the chat reads that as Rerun credits used up. What a 402 means is up to
// each server, so its own words are kept, under a sentence the chat shows as it is.
export function customEndpointFetch(inner: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
        const response = await inner(input, { ...init, dispatcher: customEndpointDispatcher } as RequestInit)
        if (response.status !== 402) return response
        const text = await response.text()
        return refusalResponse(response, text, `${CUSTOM_ENDPOINT_REFUSED}: ${reasonOf(text, response.statusText)}`, 'custom')
    }
}
