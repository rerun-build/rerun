import { isSetupAnswered } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'

describe('isSetupAnswered', () => {
    it('treats an unanswered question as unanswered', () => {
        expect(isSetupAnswered({ required: null, prompt: '' })).toBe(false)
        expect(isSetupAnswered({ required: null, prompt: 'Ask for the Stripe key.' })).toBe(false)
    })

    it('rejects a yes with nothing behind it', () => {
        expect(isSetupAnswered({ required: true, prompt: '' })).toBe(false)
        expect(isSetupAnswered({ required: true, prompt: '   \n  ' })).toBe(false)
    })

    it('accepts a yes with instructions and a plain no', () => {
        expect(isSetupAnswered({ required: true, prompt: 'Ask for the Stripe key, then test it.' })).toBe(true)
        expect(isSetupAnswered({ required: false, prompt: '' })).toBe(true)
    })
})
