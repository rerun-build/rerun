import { RERUN_CONNECTION_ID, RERUN_MODELS } from '@moldwright/contracts'
import { describe, expect, it } from 'vitest'
import { isModelLocked } from './ai-sources'

describe('isModelLocked', () => {
    it('locks Smart and the premium models of every connection before the first charge', () => {
        expect(isModelLocked(RERUN_CONNECTION_ID, RERUN_MODELS.smart, false)).toBe(true)
        expect(isModelLocked('cnx-claude', 'claude-opus-5-5', false)).toBe(true)
        expect(isModelLocked('cnx-anthropic', 'claude-fable-5-1', false)).toBe(true)
        expect(isModelLocked('cnx-codex', 'gpt-6-astra', false)).toBe(true)
    })

    it('leaves the rest of a trial open', () => {
        expect(isModelLocked(RERUN_CONNECTION_ID, RERUN_MODELS.balanced, false)).toBe(false)
        expect(isModelLocked('cnx-claude', 'claude-sonnet-5[1m]', false)).toBe(false)
        expect(isModelLocked('cnx-codex', 'gpt-6-sol', false)).toBe(false)
    })

    it('locks nothing on a paid plan', () => {
        expect(isModelLocked(RERUN_CONNECTION_ID, RERUN_MODELS.smart, true)).toBe(false)
        expect(isModelLocked('cnx-claude', 'claude-opus-5-5', true)).toBe(false)
    })
})
