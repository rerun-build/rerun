export class HttpError extends Error {
    status: number
    code?: string
    constructor(status: number, message: string, code?: string) {
        super(message)
        this.status = status
        this.code = code
        this.name = 'HttpError'
    }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`)

export const badRequest = (message: string) => new HttpError(400, message)

export const unauthorized = (message = 'Unauthorized') => new HttpError(401, message)

export const agentDisabled = () => new HttpError(403, 'This coworker is switched off and cannot run.')

export const setupPending = () => new HttpError(409, 'This coworker is still being set up. Its tasks can run once the setup is finished.')

// The code names the hold a scheduled run ran into, so the scheduler can tell a routine skip from
// a failure without reading the HTTP status.
export const coworkerBusy = () => new HttpError(409, 'Another run of this coworker is live and it drives a screen; the scheduled run waits for it to end.', 'coworker_busy')

export const subscriptionLimited = () => new HttpError(429, "This coworker's subscription has hit its usage limit; scheduled runs are paused until it resets.", 'subscription_limited')

export const budgetExhausted = () => new HttpError(402, 'Rerun credits used up; automated runs on Rerun models are paused until they reset or you add credits.', 'budget_latched')

export const checkinsDisabled = () => new HttpError(403, 'The check-ins of the Chief of Staff are switched off on this box.', 'checkins_disabled')

export const checkinBusy = () => new HttpError(409, 'The Chief of Staff is already checking in; this one waits for it to end.', 'checkin_busy')

export const promiseCapReached = () => new HttpError(429, 'The Chief of Staff already came back to its own routines as often as it may today.', 'promise_cap')
