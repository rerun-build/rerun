import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ComposioApiError, uploadComposioFile } from './client'

describe('uploadComposioFile', () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 media kit')

    beforeEach(() => {
        vi.stubEnv('COMPOSIO_API_KEY', 'composio-key')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.unstubAllGlobals()
    })

    it('asks Composio where to put the file, puts it there and returns its key', async () => {
        const fetchMock = vi.fn(async (url: string) => (url.endsWith('/files/upload/request') ? Response.json({ key: 'project/files/kit.pdf', new_presigned_url: 'https://bucket.test/kit.pdf?sig=1' }) : new Response(null, { status: 200 })))
        vi.stubGlobal('fetch', fetchMock)

        const key = await uploadComposioFile('GMAIL_SEND_EMAIL', 'gmail', { name: 'kit.pdf', mimetype: 'application/pdf', bytes })

        expect(key).toBe('project/files/kit.pdf')
        const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
        expect(requestUrl).toBe('https://backend.composio.dev/api/v3.1/files/upload/request')
        expect(JSON.parse(requestInit.body as string)).toEqual({
            filename: 'kit.pdf',
            mimetype: 'application/pdf',
            md5: createHash('md5').update(bytes).digest('hex'),
            tool_slug: 'GMAIL_SEND_EMAIL',
            toolkit_slug: 'gmail',
        })
        const [putUrl, putInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit]
        expect(putUrl).toBe('https://bucket.test/kit.pdf?sig=1')
        expect(putInit).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/pdf' } })
        expect(putInit).not.toHaveProperty('headers.x-api-key')
    })

    it('fails when the bucket refuses the file', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/files/upload/request') ? Response.json({ key: 'k', new_presigned_url: 'https://bucket.test/k' }) : new Response('denied', { status: 403 }))))

        await expect(uploadComposioFile('GMAIL_SEND_EMAIL', 'gmail', { name: 'kit.pdf', mimetype: 'application/pdf', bytes })).rejects.toBeInstanceOf(ComposioApiError)
    })
})
