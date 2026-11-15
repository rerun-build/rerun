import { APICallError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'

import { classifyChatError } from '@/lib/chat-error'

import { foremanErrorText } from './error-text'

const apiError = (statusCode: number) => new APICallError({ message: `Provider said ${statusCode}`, url: 'https://openrouter.ai/api/v1/chat/completions', requestBodyValues: {}, statusCode })

describe('foremanErrorText', () => {
    it('reads a rate limit as an overloaded provider', () => {
        expect(classifyChatError(foremanErrorText(apiError(429)))).toBe('overloaded')
    })

    it('reads a server failure as an overloaded provider', () => {
        expect(classifyChatError(foremanErrorText(apiError(503)))).toBe('overloaded')
        expect(classifyChatError(foremanErrorText(apiError(529)))).toBe('overloaded')
    })

    it('shows a refused Rerun key as neither the budget wall nor a signed-out connection', () => {
        expect(classifyChatError(foremanErrorText(apiError(402)))).toBe('generic')
        expect(classifyChatError(foremanErrorText(apiError(401)))).toBe('generic')
        expect(foremanErrorText(apiError(402))).not.toContain('402')
    })

    it('reads the last attempt of a retried call', () => {
        const retried = new RetryError({ message: 'Failed after 3 attempts', reason: 'maxRetriesExceeded', errors: [apiError(503), apiError(503)] })

        expect(classifyChatError(foremanErrorText(retried))).toBe('overloaded')
    })

    it('keeps the text a tool wrote for the model', () => {
        const message = 'A plan needs its one item: the coworker for the job they picked, with its name and its role.'

        expect(foremanErrorText(new Error(message))).toBe(message)
    })

    it('keeps a thrown value that is not an Error', () => {
        expect(foremanErrorText('No Box with id 4 in this workspace.')).toBe('No Box with id 4 in this workspace.')
    })
})
