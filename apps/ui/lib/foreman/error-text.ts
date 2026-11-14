import { APICallError, RetryError } from 'ai'

const RATE_LIMITED = 'The model is rate limited right now. Send your message again in a moment.'
const OVERLOADED = 'The model is overloaded right now. Send your message again in a moment.'
const UNAVAILABLE = 'The Chief of Staff is unavailable right now. Try again in a few minutes.'

export function foremanErrorText(error: unknown): string {
    if (RetryError.isInstance(error)) return foremanErrorText(error.lastError)
    if (APICallError.isInstance(error)) {
        if (error.statusCode === 429) return RATE_LIMITED
        if (error.statusCode !== undefined && error.statusCode >= 500) return OVERLOADED
        return UNAVAILABLE
    }
    return error instanceof Error ? error.message : String(error)
}
