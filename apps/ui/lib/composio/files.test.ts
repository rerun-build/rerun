import { describe, expect, it, vi } from 'vitest'

import { boxFileLocations, resolveFileArgs, withFilePaths } from './files'

const FILE_UPLOADABLE = {
    type: 'object',
    title: 'FileUploadable',
    required: ['name', 'mimetype', 's3key'],
    properties: { name: { type: 'string' }, s3key: { type: 'string' }, mimetype: { type: 'string' } },
    file_uploadable: true,
}

// GMAIL_SEND_EMAIL as Composio describes it, trimmed to three of its inputs.
const GMAIL_SEND_EMAIL = {
    type: 'object',
    properties: {
        recipient_email: { type: 'string' },
        body: { type: 'string' },
        attachment: { anyOf: [FILE_UPLOADABLE, { type: 'array', items: FILE_UPLOADABLE }], title: 'Attachment' },
    },
}

describe('withFilePaths', () => {
    it('turns every file input into a path, alone or in a list, and leaves the rest alone', () => {
        const schema = withFilePaths(GMAIL_SEND_EMAIL) as typeof GMAIL_SEND_EMAIL
        const [single, list] = schema.properties.attachment.anyOf as unknown as [Record<string, unknown>, { items: Record<string, unknown> }]

        expect(single).toMatchObject({ type: 'string' })
        expect(single).not.toHaveProperty('properties')
        expect(list.items).toMatchObject({ type: 'string' })
        expect(JSON.stringify(schema)).not.toContain('s3key')
        expect(schema.properties.recipient_email).toEqual({ type: 'string' })
    })

    it('keeps the title and the description Composio gives a file input', () => {
        const schema = withFilePaths({ type: 'object', properties: { thumbnail: { ...FILE_UPLOADABLE, description: 'Thumbnail image of the video.' } } }) as { properties: { thumbnail: Record<string, unknown> } }

        expect(schema.properties.thumbnail).toMatchObject({ title: 'FileUploadable', type: 'string' })
        expect(schema.properties.thumbnail.description).toMatch(/^Thumbnail image of the video\. Path of a file in your workspace/)
    })

    it('returns a schema without file inputs as it is', () => {
        const schema = { type: 'object', properties: { query: { type: 'string' } } }
        expect(withFilePaths(schema)).toEqual(schema)
    })
})

describe('resolveFileArgs', () => {
    const upload = vi.fn(async (path: string) => ({ name: path.split('/').pop()!, mimetype: 'application/pdf', s3key: `key/${path}` }))

    it('uploads a path given for a file and keeps the other arguments', async () => {
        const args = await resolveFileArgs(GMAIL_SEND_EMAIL, { recipient_email: 'a@b.c', attachment: 'kit/media-kit.pdf' }, upload)

        expect(args).toEqual({ recipient_email: 'a@b.c', attachment: { name: 'media-kit.pdf', mimetype: 'application/pdf', s3key: 'key/kit/media-kit.pdf' } })
    })

    it('uploads every path of a list', async () => {
        const args = await resolveFileArgs(GMAIL_SEND_EMAIL, { attachment: ['a.pdf', 'b.pdf'] }, upload)

        expect(args.attachment).toEqual([
            { name: 'a.pdf', mimetype: 'application/pdf', s3key: 'key/a.pdf' },
            { name: 'b.pdf', mimetype: 'application/pdf', s3key: 'key/b.pdf' },
        ])
    })

    it('uploads the files of one call one after the other', async () => {
        let inFlight = 0
        let mostInFlight = 0
        const slowUpload = async (path: string) => {
            inFlight += 1
            mostInFlight = Math.max(mostInFlight, inFlight)
            await new Promise(resolve => setTimeout(resolve, 5))
            inFlight -= 1
            return { name: path, mimetype: 'application/pdf', s3key: `key/${path}` }
        }

        await resolveFileArgs(GMAIL_SEND_EMAIL, { attachment: ['a.pdf', 'b.pdf', 'c.pdf'] }, slowUpload)

        expect(mostInFlight).toBe(1)
    })

    it('reads an empty path as no file', async () => {
        upload.mockClear()

        const args = await resolveFileArgs(GMAIL_SEND_EMAIL, { recipient_email: 'a@b.c', attachment: '' }, upload)

        expect(JSON.parse(JSON.stringify(args))).toEqual({ recipient_email: 'a@b.c' })
        expect(upload).not.toHaveBeenCalled()
    })

    it('passes a file Composio already holds as it is', async () => {
        upload.mockClear()
        const held = { name: 'invoice.pdf', mimetype: 'application/pdf', s3key: '47563/gmail/GET_ATTACHMENT/response/1' }

        const args = await resolveFileArgs(GMAIL_SEND_EMAIL, { attachment: held }, upload)

        expect(args.attachment).toEqual(held)
        expect(upload).not.toHaveBeenCalled()
    })
})

describe('boxFileLocations', () => {
    it('looks for a relative path in the coworker files, then in the shared space', () => {
        expect(boxFileLocations('verified-kit/kit.pdf', 'xg97')).toEqual([
            { base: '/agents/xg97/files', path: 'verified-kit/kit.pdf' },
            { base: '/shared/files', path: 'verified-kit/kit.pdf' },
        ])
    })

    it('reads an absolute path of the coworker workspace in its files only', () => {
        expect(boxFileLocations('/home/rerun/rerun/agents/xg97/workspace/verified-kit/kit.pdf', 'xg97')).toEqual([{ base: '/agents/xg97/files', path: 'verified-kit/kit.pdf' }])
    })

    it('reads an absolute path of the shared space in the shared files only', () => {
        expect(boxFileLocations('/home/rerun/rerun/shared/content/media-kit.pdf', 'xg97')).toEqual([{ base: '/shared/files', path: 'content/media-kit.pdf' }])
    })

    it('refuses the workspace of another coworker and any other absolute path', () => {
        expect(boxFileLocations('/home/rerun/rerun/agents/other/workspace/kit.pdf', 'xg97')).toEqual([])
        expect(boxFileLocations('/etc/passwd', 'xg97')).toEqual([])
    })
})
