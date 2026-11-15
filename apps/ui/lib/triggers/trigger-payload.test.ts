import { describe, expect, it } from 'vitest'
import { parseTriggerPayload } from './trigger-payload'

function block(attrs: string, body?: string): string {
    return body === undefined ? `<trigger_payload ${attrs}>(no payload)</trigger_payload>` : `<trigger_payload ${attrs}>\n${body}\n</trigger_payload>`
}

const attrs = 'trigger="github-push" method="POST" received="2026-08-10T09:12:44.113Z" content-type="application/json" bytes="25"'

describe('parseTriggerPayload', () => {
    it('ignores a message without a payload block', () => {
        expect(parseTriggerPayload('Just a normal chat message about trigger_payload stuff')).toBeNull()
    })

    it('splits the trigger prompt from the payload', () => {
        const parsed = parseTriggerPayload(`Review the incoming commit.\n\n${block(attrs, '{\n  "ref": "refs/heads/main"\n}')}`)
        expect(parsed).toMatchObject({
            prompt: 'Review the incoming commit.',
            slug: 'github-push',
            method: 'POST',
            receivedAt: '2026-08-10T09:12:44.113Z',
            contentType: 'application/json',
            bytes: 25,
            truncated: false,
            isJson: true,
        })
        expect(parsed?.body).toBe('{\n  "ref": "refs/heads/main"\n}')
    })

    it('reads an empty payload as no body', () => {
        const parsed = parseTriggerPayload(`Do the thing.\n\n${block('trigger="dfsqd" method="GET" received="2026-08-10T10:11:17.943Z" bytes="0"')}`)
        expect(parsed?.body).toBe('')
        expect(parsed?.isJson).toBe(false)
        expect(parsed?.method).toBe('GET')
    })

    it('keeps the query string and marks a truncated payload', () => {
        const parsed = parseTriggerPayload(`Go.\n\n${block(`${attrs} query="source=zapier&id=7" truncated="true"`, 'x')}`)
        expect(parsed?.query).toBe('source=zapier&id=7')
        expect(parsed?.truncated).toBe(true)
    })

    it('restores a closing tag the engine escaped', () => {
        const parsed = parseTriggerPayload(`Go.\n\n${block(attrs, 'hello <\\/trigger_payload> world')}`)
        expect(parsed?.body).toBe('hello </trigger_payload> world')
    })

    it('survives an angle bracket inside an attribute', () => {
        const parsed = parseTriggerPayload(`Go.\n\n${block(`${attrs} query="filter=a>b"`, 'ok')}`)
        expect(parsed?.query).toBe('filter=a>b')
        expect(parsed?.body).toBe('ok')
    })

    it('handles a trigger with no prompt of its own', () => {
        const parsed = parseTriggerPayload(`\n\n${block(attrs, 'ok')}`)
        expect(parsed?.prompt).toBe('')
    })
})
