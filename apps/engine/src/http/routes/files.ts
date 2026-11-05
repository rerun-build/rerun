import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { MAX_UPLOAD_FILE_BYTES, writeFileSchema } from '@rerun/contracts'
import { badRequest } from '../../lib/errors.js'
import * as store from '../../files/store.js'

const MIME_TYPES: Record<string, string> = {
    txt: 'text/plain',
    md: 'text/markdown',
    json: 'application/json',
    csv: 'text/csv',
    html: 'text/html',
    css: 'text/css',
    js: 'text/javascript',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    wav: 'audio/wav',
    zip: 'application/zip',
}

function mimeFor(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? ''
    return MIME_TYPES[ext] ?? 'application/octet-stream'
}

// A browser plays a video by asking for it piece by piece: Safari refuses one served whole, and
// seeking anywhere needs it. Several ranges in one request, or a malformed one, get the whole file,
// which the spec allows.
export function parseByteRange(header: string | undefined, size: number): store.ByteRange | 'unsatisfiable' | null {
    const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/)
    if (!match) return null
    const [, first, last] = match
    if (!first && !last) return null
    if (!first) {
        const suffix = Number(last)
        if (suffix === 0 || size === 0) return 'unsatisfiable'
        return { start: Math.max(0, size - suffix), end: size - 1 }
    }
    const start = Number(first)
    const end = last ? Number(last) : size - 1
    if (last && end < start) return null
    if (start >= size) return 'unsatisfiable'
    return { start, end: Math.min(end, size - 1) }
}

function requirePath(c: Context, key = 'path'): string {
    const path = c.req.query(key)
    if (!path) throw badRequest(`Missing "${key}" query parameter`)
    return path
}

export function createFilesRouter(getRoot: (c: Context) => string): Hono {
    const router = new Hono()

    // Asking for a file that is not there is an answer, not a failure: an agent that installed no
    // connector has no .rerun/services.json, and the UI asks for it on every load. Left to reach
    // the app-wide handler it came back 500 and logged an unhandled error for the most ordinary
    // state there is. Scoped to this router so an ENOENT raised anywhere else still surfaces.
    router.onError((err, c) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return c.json({ error: 'file not found' }, 404)
        if ((err as NodeJS.ErrnoException).code === 'ENOSPC') return c.json({ error: 'The Box has no disk space left.' }, 507)
        throw err
    })

    router.get('/', async c => {
        const entries = await store.listEntries(getRoot(c), c.req.query('path') ?? '.')
        return c.json({ entries })
    })

    router.get('/read', async c => {
        const path = requirePath(c)
        const offset = z.coerce.number().int().nonnegative().default(0).parse(c.req.query('offset'))
        const page = store.paginateText(await store.readText(getRoot(c), path), offset)
        return c.json({ path, ...page })
    })

    router.get('/raw', async c => {
        const path = requirePath(c)
        const root = getRoot(c)
        const size = await store.fileSize(root, path)
        const range = parseByteRange(c.req.header('Range'), size)
        if (range === 'unsatisfiable') return c.body(null, 416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' })

        const name = path.split('/').pop() ?? 'file'
        const headers = {
            'Content-Type': mimeFor(path),
            'Content-Disposition': `inline; filename="${name}"`,
            'Accept-Ranges': 'bytes',
        }
        if (!range) return c.body(await store.readByteStream(root, path), 200, { ...headers, 'Content-Length': String(size) })
        return c.body(await store.readByteStream(root, path, range), 206, {
            ...headers,
            'Content-Length': String(range.end - range.start + 1),
            'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        })
    })

    router.put('/', async c => {
        const body = writeFileSchema.parse(await c.req.json())
        await store.writeText(getRoot(c), body.path, body.content)
        return c.json({ path: body.path, bytes: body.content.length }, 201)
    })

    router.post('/raw', async c => {
        const body = await c.req.parseBody()
        const file = body.file
        if (!(file instanceof File)) throw badRequest('Expected a multipart "file" field')
        const dir = c.req.query('dir') ?? ''
        const path = c.req.query('path') ?? (dir ? `${dir.replace(/\/$/, '')}/${file.name}` : file.name)
        const data = new Uint8Array(await file.arrayBuffer())
        await store.writeBytes(getRoot(c), path, data)
        return c.json({ path, bytes: data.byteLength }, 201)
    })

    // The bytes are the body rather than a multipart field, and they are piped straight to disk. The
    // multipart POST above holds the whole file in memory twice, which a 512 MB Box does not survive.
    router.put('/raw', async c => {
        const body = c.req.raw.body
        if (!body) throw badRequest('Expected the file bytes as the request body')

        const dir = c.req.query('dir') ?? ''
        const name = c.req.query('name')
        const path = c.req.query('path') ?? (name ? [dir.replace(/\/$/, ''), name].filter(Boolean).join('/') : null)
        if (!path) throw badRequest('Missing "name" or "path" query parameter')

        // `Content-Length` is a forbidden header for fetch, so the sender passes the size here instead.
        // It only buys an early refusal; the cap that counts runs inside the pipe.
        const declared = Number(c.req.query('size') ?? 0)
        if (declared > MAX_UPLOAD_FILE_BYTES) throw badRequest(`This file is larger than the ${MAX_UPLOAD_FILE_BYTES / 1024 / 1024} MB upload limit.`)

        const bytes = await store.writeStream(getRoot(c), path, body, MAX_UPLOAD_FILE_BYTES)
        return c.json({ path, bytes }, 201)
    })

    router.post('/move', async c => {
        const body = z.object({ from: z.string().min(1), to: z.string().min(1) }).parse(await c.req.json())
        await store.move(getRoot(c), body.from, body.to)
        return c.json({ from: body.from, to: body.to })
    })

    router.post('/dir', async c => {
        const body = z.object({ path: z.string().min(1) }).parse(await c.req.json())
        await store.ensureDir(getRoot(c), body.path)
        return c.json({ path: body.path }, 201)
    })

    router.delete('/', async c => {
        const path = requirePath(c)
        await store.remove(getRoot(c), path)
        return c.json({ path })
    })

    return router
}
