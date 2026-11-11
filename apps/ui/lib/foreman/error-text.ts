import { APICallError, RetryError } from 'ai'

const RATE_LIMITED = 'The model is rate limited right now. Send your message again in a moment.'
const OVERLOADED = 'The model is overloaded right now. Send your message again in a moment.'
// Free of "402", "payment" and "unauthorized" on purpose: the foreman runs on Rerun's key, so
// neither the budget wall nor "Connection signed out" would be true for the user.
const UNAVAILABLE = 'The Chief of Staff is unavailable right now. Try again in a few minutes.'

// The SDK masks every error as "An error occurred." by default. Only the provider's failures are
// replaced here: the same text also fills the tool errors saved in the transcript, which the model
// reads back on the next turn and which our tools write for it.
export function foremanErrorText(error: unknown): string {
    if (RetryError.isInstance(error)) return foremanErrorText(error.lastError)
    if (APICallError.isInstance(error)) {
        if (error.statusCode === 429) return RATE_LIMITED
        if (error.statusCode !== undefined && error.statusCode >= 500) return OVERLOADED
        return UNAVAILABLE
    }
    return error instanceof Error ? error.message : String(error)
}
