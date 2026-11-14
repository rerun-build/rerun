import type { ErrorResponse } from 'resend'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyResendError, failureMarker, isRetriableFailure, RETRIABLE_MARKER } from './throttle'

const rateLimit: ErrorResponse = { name: 'rate_limit_exceeded', message: 'Too many requests. You can only make 10 requests per second.' }
const validation: ErrorResponse = { name: 'validation_error', message: 'Invalid `to` field.' }

describe('classifyResendError', () => {
    it('reads the two failures of the 04/09 send', () => {
        expect(classifyResendError({ statusCode: 429, ...rateLimit })).toBe('rate_limited')
        expect(classifyResendError({ statusCode: 422, ...validation })).toBe('rejected')
    })

    it('recognises a rate limit from either shape alone', () => {
        expect(classifyResendError({ statusCode: 429, name: 'something_new', message: '' })).toBe('rate_limited')
        expect(classifyResendError(rateLimit)).toBe('rate_limited')
    })

    it('holds back anything that may already have been delivered', () => {
        expect(classifyResendError({ name: 'application_error', message: 'Unable to fetch data.' })).toBe('ambiguous')
        expect(classifyResendError({ statusCode: 500, name: 'internal_server_error', message: '' })).toBe('ambiguous')
        expect(classifyResendError({ statusCode: 408, name: 'timeout', message: '' })).toBe('ambiguous')
        expect(classifyResendError({ statusCode: 409, name: 'concurrent_idempotent_requests', message: '' })).toBe('ambiguous')
        expect(classifyResendError(null)).toBe('ambiguous')
        expect(classifyResendError('boom')).toBe('ambiguous')
    })

    it('gives up on a request the same payload would fail again', () => {
        expect(classifyResendError(validation)).toBe('rejected')
        expect(classifyResendError({ name: 'invalid_from_address', message: '' })).toBe('rejected')
        expect(classifyResendError({ statusCode: 404, name: 'whatever', message: '' })).toBe('rejected')
    })
})

describe('failureMarker', () => {
    it('keeps the kind in front of the message', () => {
        expect(failureMarker(rateLimit)).toBe(`${RETRIABLE_MARKER}Too many requests. You can only make 10 requests per second.`)
        expect(failureMarker(validation)).toBe('rejected: Invalid `to` field.')
    })
})

describe('isRetriableFailure', () => {
    it('reads back only what failureMarker wrote as a rate limit', () => {
        expect(isRetriableFailure(failureMarker(rateLimit))).toBe(true)
        expect(isRetriableFailure(failureMarker(validation))).toBe(false)
        expect(isRetriableFailure(failureMarker({ name: 'application_error', message: 'Unable to fetch data.' }))).toBe(false)
    })

    it('holds back a row with no marker at all', () => {
        expect(isRetriableFailure(null)).toBe(false)
        expect(isRetriableFailure('Too many requests. You can only make 10 requests per second.')).toBe(false)
    })
})

async function freshThrottle() {
    vi.resetModules()
    return import('./throttle')
}

describe('sendThrottled', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    it('spaces departures by 200ms when callers fan out at once', async () => {
        const { sendThrottled } = await freshThrottle()
        const departures: number[] = []
        const call = async () => {
            departures.push(Date.now())
            return { data: { id: 'e' }, error: null } as const
        }

        const all = Promise.all([sendThrottled(call), sendThrottled(call), sendThrottled(call)])
        await vi.runAllTimersAsync()
        await all

        expect(departures[1] - departures[0]).toBe(200)
        expect(departures[2] - departures[1]).toBe(200)
    })

    it('retries a rate limit until it goes through', async () => {
        const { sendThrottled } = await freshThrottle()
        const call = vi
            .fn<() => Promise<{ data: { id: string }; error: null } | { data: null; error: ErrorResponse }>>()
            .mockResolvedValueOnce({ data: null, error: rateLimit })
            .mockResolvedValueOnce({ data: null, error: rateLimit })
            .mockResolvedValueOnce({ data: { id: 'e' }, error: null })

        const result = sendThrottled(call)
        await vi.runAllTimersAsync()

        expect(await result).toEqual({ data: { id: 'e' }, error: null })
        expect(call).toHaveBeenCalledTimes(3)
    })

    it('hands back a rejection without retrying it', async () => {
        const { sendThrottled } = await freshThrottle()
        const call = vi.fn(async () => ({ data: null, error: validation }) as const)

        const result = sendThrottled(call)
        await vi.runAllTimersAsync()

        expect(await result).toEqual({ data: null, error: validation })
        expect(call).toHaveBeenCalledTimes(1)
    })

    it('never replays a request that may already have been delivered', async () => {
        const { sendThrottled } = await freshThrottle()
        const ambiguous: ErrorResponse = { name: 'application_error', message: 'Unable to fetch data.' }
        const call = vi.fn(async () => ({ data: null, error: ambiguous }) as const)

        const result = sendThrottled(call)
        await vi.runAllTimersAsync()

        expect((await result).error).toEqual(ambiguous)
        expect(call).toHaveBeenCalledTimes(1)
    })

    it('stops after the last delay rather than retrying forever', async () => {
        const { sendThrottled } = await freshThrottle()
        const call = vi.fn(async () => ({ data: null, error: rateLimit }) as const)

        const result = sendThrottled(call)
        await vi.runAllTimersAsync()

        expect((await result).error).toEqual(rateLimit)
        expect(call).toHaveBeenCalledTimes(4)
    })
})
