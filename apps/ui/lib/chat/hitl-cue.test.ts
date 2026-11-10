import { describe, expect, it } from 'vitest'

import { scrollCueOf, summarizePendingHitl } from '@/lib/chat/hitl-cue'
import { englishTranslator } from '@/lib/i18n/english-translator'

const t = englishTranslator('chat.hitlCue')

describe('summarizePendingHitl', () => {
    it('counts the questions, the legacy single question included', () => {
        expect(summarizePendingHitl('question', { question: 'Which domain?' }, t).label).toBe('Question waiting')
        expect(summarizePendingHitl('question', { questions: [{ question: 'A?' }, { question: 'B?' }] }, t).label).toBe('2 questions waiting')
    })

    it('counts the approvals, the credentials and the apps', () => {
        expect(summarizePendingHitl('approval', { action: 'Send the email' }, t).label).toBe('Approval needed')
        expect(summarizePendingHitl('approval', { approvals: [{ action: 'A' }, { action: 'B' }, { action: 'C' }] }, t).label).toBe('3 approvals needed')
        expect(summarizePendingHitl('secret', { secrets: [{ key: 'A' }] }, t).label).toBe('Credential needed')
        expect(summarizePendingHitl('secret', { secrets: [{ key: 'A' }, { key: 'B' }] }, t).label).toBe('2 credentials needed')
        expect(summarizePendingHitl('service', { services: [{ slug: 'stripe' }] }, t).label).toBe('App to connect')
        expect(summarizePendingHitl('service', { services: [{ slug: 'stripe' }, { slug: 'notion' }] }, t).label).toBe('2 apps to connect')
    })

    it('names the server to sign in to when it has one', () => {
        expect(summarizePendingHitl('mcp', { name: 'Notion' }, t).label).toBe('Sign in to Notion')
        expect(summarizePendingHitl('mcp', {}, t).label).toBe('Sign-in needed')
    })

    it('says what the takeover waits for', () => {
        expect(summarizePendingHitl('takeover', { url: 'https://example.com' }, t).label).toBe('Your turn on the screen')
    })

    it('tints a decision apart from a question', () => {
        expect(summarizePendingHitl('approval', { action: 'A' }, t).tone).not.toBe(summarizePendingHitl('question', { question: 'A?' }, t).tone)
    })
})

describe('scrollCueOf', () => {
    it('shows the arrow only away from the bottom when nothing waits', () => {
        expect(scrollCueOf({ pending: false, pendingInView: true, atBottom: true })).toBeNull()
        expect(scrollCueOf({ pending: false, pendingInView: true, atBottom: false })).toBe('arrow')
    })

    it('turns the arrow into the pill while the waiting block is out of sight', () => {
        expect(scrollCueOf({ pending: true, pendingInView: false, atBottom: false })).toBe('pill')
    })

    it('shows nothing at the bottom, even while the block arriving there still reads out of sight', () => {
        expect(scrollCueOf({ pending: true, pendingInView: false, atBottom: true })).toBeNull()
    })

    it('shows nothing over a waiting block in sight, even unstuck from the bottom', () => {
        expect(scrollCueOf({ pending: true, pendingInView: true, atBottom: false })).toBeNull()
    })
})
