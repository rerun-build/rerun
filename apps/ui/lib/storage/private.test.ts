import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Database } from '@/app/api/database.types'
import { downloadPrivateFile, STORAGE_BUSY_ERROR } from './private'

// What Supabase Storage sends back while its own Postgres connection is refused, as seen in
// production on 2026-11-02 at 22:30 UTC.
const SLOW_DOWN = { statusCode: '429', error: 'too_many_connections', code: 'SlowDown', message: 'Too many connections issued to the database' }
const NOT_FOUND = { statusCode: '404', error: 'not_found', message: 'Object not found' }

const supabase = createClient<Database>('https://project.supabase.co', 'service-role-key', { auth: { persistSession: false, autoRefreshToken: false } })

const json = (body: object, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const archive = () => new Response(new Blob(['tarball']), { status: 200 })

let fetchMock: ReturnType<typeof vi.fn>
let warn: ReturnType<typeof vi.spyOn>

function answer(...responses: (() => Response)[]) {
    responses.forEach(response => fetchMock.mockImplementationOnce(async () => response()))
}

async function download(): Promise<Blob> {
    const pending = downloadPrivateFile(supabase, 'agent-archives', 'template/agent/archive.tar.gz')
    pending.catch(() => {})
    await vi.runAllTimersAsync()
    return pending
}

describe('downloadPrivateFile', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
        warn.mockRestore()
    })

    it('downloads again when Storage is out of database connections', async () => {
        answer(
            () => json(SLOW_DOWN, 429),
            () => archive()
        )

        const blob = await download()

        expect(await blob.text()).toBe('tarball')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('downloads again after a 503', async () => {
        answer(
            () => json({ statusCode: '503', error: 'unavailable', message: 'Service Unavailable' }, 503),
            () => archive()
        )

        expect(await (await download()).text()).toBe('tarball')
    })

    it('gives up with a sentence a user can read once Storage stays saturated', async () => {
        answer(...Array.from({ length: 4 }, () => () => json(SLOW_DOWN, 429)))

        const error = await download().catch((err: Error) => err)

        expect(error).toBeInstanceOf(Error)
        expect((error as Error).message).toBe(STORAGE_BUSY_ERROR)
        expect(STORAGE_BUSY_ERROR).not.toMatch(/database|connection/i)
        expect(fetchMock).toHaveBeenCalledTimes(4)
        expect((error as Error).cause).toMatchObject({ status: 429, message: 'Too many connections issued to the database' })
        expect(warn).toHaveBeenCalledOnce()
        expect(warn).toHaveBeenCalledWith(expect.any(String), 'agent-archives', 'template/agent/archive.tar.gz', 429, 'Too many connections issued to the database')
    })

    it('fails at once on a missing object', async () => {
        answer(() => json(NOT_FOUND, 404))

        await expect(download()).rejects.toThrow('Object not found')
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(warn).not.toHaveBeenCalled()
    })
})
