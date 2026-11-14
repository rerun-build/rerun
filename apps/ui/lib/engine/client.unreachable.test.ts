import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineRequestError, EngineUnreachableError, chat, deleteAgent, fetchRawFile, listConnections } from './client'

const conn = { baseUrl: 'https://engine.test', apiKey: 'k' }

function stubFetch(impl: () => Promise<Response>) {
    vi.stubGlobal('fetch', vi.fn(impl))
}

function timeoutError(): Error {
    return Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
}

afterEach(() => vi.unstubAllGlobals())

describe('engine client, box unreachable', () => {
    it('turns a refused connection into a readable error that keeps its cause', async () => {
        const refused = new TypeError('fetch failed')
        stubFetch(async () => {
            throw refused
        })
        const err = await listConnections(conn).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(EngineUnreachableError)
        expect((err as Error).message).not.toContain('fetch failed')
        expect((err as Error).cause).toBe(refused)
    })

    it('treats a timeout as unreachable', async () => {
        stubFetch(async () => {
            throw timeoutError()
        })
        await expect(listConnections(conn)).rejects.toBeInstanceOf(EngineUnreachableError)
    })

    it('lets a deliberate abort through untouched', async () => {
        const aborted = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })
        stubFetch(async () => {
            throw aborted
        })
        await expect(listConnections(conn)).rejects.toBe(aborted)
    })

    it('keeps an answer from the box as an EngineRequestError', async () => {
        stubFetch(async () => new Response('boom', { status: 500 }))
        const err = await listConnections(conn).catch((e: unknown) => e)
        expect(err).toBeInstanceOf(EngineRequestError)
        expect((err as EngineRequestError).status).toBe(500)
    })

    it('applies to the routes that call fetch directly', async () => {
        stubFetch(async () => {
            throw new TypeError('fetch failed')
        })
        await expect(deleteAgent(conn, 'a1')).rejects.toBeInstanceOf(EngineUnreachableError)
        await expect(chat(conn, 'a1', { message: 'hi' })).rejects.toBeInstanceOf(EngineUnreachableError)
        await expect(fetchRawFile(conn, '/shared/files', 'notes.md')).rejects.toBeInstanceOf(EngineUnreachableError)
    })
})
