import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinkupError, downloadAttachment, parseEnvelope, runFlatEndpoint } from './client'

describe('parseEnvelope', () => {
    it('keeps a 19-digit LinkedIn id exact by reading it as a string', () => {
        const envelope = parseEnvelope<{ invitation_id: string; member_distance: number }>('{"success":true,"data":{"invitation_id": 7453486530700017665,"member_distance":2}}')
        expect(envelope).toEqual({ success: true, data: { invitation_id: '7453486530700017665', member_distance: 2 } })
    })

    it('leaves digits inside a string alone', () => {
        expect(parseEnvelope('{"success":true,"data":{"text":"call 7453486530700017665 now"}}')).toEqual({ success: true, data: { text: 'call 7453486530700017665 now' } })
        expect(parseEnvelope('not json')).toBeNull()
    })
})

describe('downloadAttachment', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    })

    it('asks for the file with the account it is given and hands back the bytes', async () => {
        vi.stubEnv('LINKUP_API_KEY', 'key')
        const fetchMock = vi.fn().mockResolvedValue(
            new Response('opus-bytes', { status: 200, headers: { 'content-type': 'audio/ogg; codecs=opus', 'content-length': '10', 'content-disposition': 'attachment; filename="voice.ogg"' } }),
        )
        vi.stubGlobal('fetch', fetchMock)
        const file = await downloadAttachment('acc', { message_id: '3EB0', filename: 'voice.ogg' })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.linkupapi.com/v2/messages/attachment?account_id=acc&message_id=3EB0&filename=voice.ogg')
        expect(init.headers).toEqual({ 'x-api-key': 'key' })
        expect(file).toMatchObject({ contentType: 'audio/ogg; codecs=opus', filename: 'voice.ogg', size: 10 })
        expect(await new Response(file.body).text()).toBe('opus-bytes')
    })

    it('reads a refusal from the V2 envelope', async () => {
        vi.stubEnv('LINKUP_API_KEY', 'key')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: false, error: { code: 'INVALID_PARAMS', message: 'Attachment not found' } }, { status: 400 })))
        const failure = downloadAttachment('acc', { message_id: 'gone' })
        await expect(failure).rejects.toBeInstanceOf(LinkupError)
        await expect(failure).rejects.toMatchObject({ code: 'INVALID_PARAMS', message: 'Attachment not found', status: 400 })
    })
})

describe('runFlatEndpoint', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
    })

    it('sends the parameters flat, with the account it is given whatever the call says', async () => {
        vi.stubEnv('LINKUP_API_KEY', 'key')
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ success: true, data: { items: [] } }))
        vi.stubGlobal('fetch', fetchMock)
        await expect(runFlatEndpoint('acc', 'typeahead', { type: 'company', keyword: 'Stripe', account_id: 'someone-else' })).resolves.toEqual({ items: [] })
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://api.linkupapi.com/v2/typeahead')
        expect(JSON.parse(init.body)).toEqual({ type: 'company', keyword: 'Stripe', account_id: 'acc' })
    })
})
