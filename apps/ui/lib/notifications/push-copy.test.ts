import { loadMessages } from '@rerun/i18n/messages'
import { createTranslator } from 'use-intl'
import { describe, expect, it } from 'vitest'

import type { StoredNotification } from './inbound'
import { pushCopyOf } from './push-copy'

const englishMessages = await loadMessages('en')
const frenchMessages = await loadMessages('fr')
const english = { t: createTranslator({ locale: 'en', messages: englishMessages, namespace: 'push' }), tErrors: createTranslator({ locale: 'en', messages: englishMessages, namespace: 'chatErrors' }) }
const french = { t: createTranslator({ locale: 'fr', messages: frenchMessages, namespace: 'push' }), tErrors: createTranslator({ locale: 'fr', messages: frenchMessages, namespace: 'chatErrors' }) }

const notification = (patch: Partial<StoredNotification>): StoredNotification => ({
    event: 'agent.notification',
    kind: 'info',
    agentId: 'engine-agent',
    message: '',
    timestamp: '2026-10-23T09:00:00Z',
    ...patch,
})

const copyOf = (patch: Partial<StoredNotification>, translators = english) => pushCopyOf({ agentName: 'Prospect Research', notification: notification(patch), ...translators })

const CODEX_REFUSAL = `Error: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account."}}`

describe('pushCopyOf', () => {
    it('reads the routine name the engine sends on its own, and writes in the reader\'s language', () => {
        const copy = copyOf({ event: 'agent.schedule.completed', kind: 'done', message: 'Schedule "daily" completed', metadata: { scheduleSlug: 'daily', sourceName: 'Morning brief' } }, french)
        expect(copy.subtitle).toBe('Morning brief · Terminé')
    })

    it('names the trigger and says what broke in words, not the provider JSON', () => {
        const copy = copyOf({
            event: 'agent.trigger.completed',
            kind: 'error',
            message: `Trigger "LinkedIn events" failed: ${CODEX_REFUSAL}`,
            metadata: { triggerSlug: 'linkedin-events', error: CODEX_REFUSAL },
        })
        expect(copy.title).toBe('Prospect Research')
        expect(copy.subtitle).toBe('LinkedIn events · Failed')
        expect(copy.body).toMatch(/^Your ChatGPT plan doesn't include .+\. Pick another model to keep going\.$/)
        expect(copy.silent).toBe(false)
    })

    it('says what broke in the reader\'s language', () => {
        const copy = copyOf({ event: 'agent.trigger.completed', kind: 'error', message: `Trigger "LinkedIn events" failed: ${CODEX_REFUSAL}`, metadata: { triggerSlug: 'linkedin-events', error: CODEX_REFUSAL } }, french)
        expect(copy.subtitle).toBe('LinkedIn events · Échec')
        expect(copy.body).toMatch(/^Votre forfait ChatGPT n'inclut pas .+\. Choisissez un autre modèle pour continuer\.$/)
    })

    it('keeps an error no kind explains as the provider wrote it, in any language', () => {
        expect(copyOf({ event: 'agent.message.completed', kind: 'error', message: 'Message failed: AI_APICallError: Disk is full' }, french).body).toBe('Disk is full')
    })

    it('reads the error from the message when the metadata has none', () => {
        const copy = copyOf({ event: 'agent.message.completed', kind: 'error', message: 'Message failed: AI_APICallError: Disk is full' })
        expect(copy).toMatchObject({ subtitle: 'Failed', body: 'Disk is full' })
    })

    it('falls back on the slug when the message does not name the schedule', () => {
        expect(copyOf({ event: 'agent.schedule.completed', kind: 'done', message: 'Run over', metadata: { scheduleSlug: 'daily-digest' } }).subtitle).toBe('daily-digest · Done')
    })

    it('leaves a finished schedule without a body, and silent', () => {
        expect(copyOf({ event: 'agent.schedule.completed', kind: 'done', message: 'Schedule "Daily digest" completed' })).toEqual({ title: 'Prospect Research', subtitle: 'Daily digest · Done', body: undefined, silent: true })
    })

    it('shows the reply of a finished chat, silent', () => {
        expect(copyOf({ event: 'agent.message.completed', kind: 'done', message: 'Found 12 leads.' })).toMatchObject({ subtitle: 'Done', body: 'Found 12 leads.', silent: true })
    })

    it.each([
        ['question', 'Question'],
        ['approval', 'Needs approval'],
        ['connector', 'Needs an app'],
        ['info', 'Update'],
    ] as const)('puts what the %s is about in the body', (kind, subtitle) => {
        expect(copyOf({ kind, message: 'Which list first?' })).toEqual({ title: 'Prospect Research', subtitle, body: 'Which list first?', silent: false })
    })

    it('keeps the body on one short line', () => {
        const body = copyOf({ kind: 'info', message: `First line\n\n${'word '.repeat(60)}` }).body ?? ''
        expect(body.startsWith('First line word')).toBe(true)
        expect(body.length).toBeLessThanOrEqual(180)
        expect(body.endsWith('…')).toBe(true)
    })
})
