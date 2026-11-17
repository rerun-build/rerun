import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-remote-routes-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''
process.env.RERUN_REMOTE_COMPUTERS = 'on'

const { beforeEach, describe, expect, it, vi } = await import('vitest')
const { mkdir, readFile, rm, stat, writeFile } = await import('node:fs/promises')
const { createServer } = await import('../server.js')
const { remoteComputersPath, remoteDir } = await import('../../config/paths.js')
const { readComputers } = await import('../../remote/store.js')

const app = createServer()

function send(method: string, path: string, body?: unknown) {
    return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

beforeEach(async () => {
    await rm(remoteDir(), { recursive: true, force: true })
})

describe('/remote/computers', () => {
    it('lists nothing on a box no computer was linked to', async () => {
        const res = await send('GET', '/remote/computers')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ computers: [] })
    })

    it('registers a computer the hub linked, offline until it connects, in a file only the engine reads', async () => {
        const res = await send('PUT', '/remote/computers/c1', { handle: 'studio-pc', name: 'Studio PC' })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ id: 'c1', handle: 'studio-pc', name: 'Studio PC', online: false, paused: false, lastSeenAt: null, facts: null, capabilities: [], settings: { mode: 'remember', unattended: true } })
        expect((await stat(remoteComputersPath())).mode & 0o777).toBe(0o600)
        expect((await stat(remoteDir())).mode & 0o777).toBe(0o700)
    })

    it('renames a computer and changes only the settings it is sent', async () => {
        await send('PUT', '/remote/computers/c1', { handle: 'studio-pc', name: 'Studio PC', settings: { mode: 'ask', allowedPrograms: ['ffmpeg'] } })
        const res = await send('PUT', '/remote/computers/c1', { handle: 'studio-pc', name: 'Edit suite', settings: { unattended: false } })
        expect(await res.json()).toMatchObject({ name: 'Edit suite', handle: 'studio-pc', settings: { mode: 'ask', unattended: false, allowedPrograms: ['ffmpeg'] } })
        expect(await readComputers()).toHaveLength(1)
    })

    it('refuses a handle that could not be written as #handle, and settings out of shape', async () => {
        expect((await send('PUT', '/remote/computers/c1', { handle: 'Studio PC', name: 'Studio PC' })).status).toBe(400)
        expect((await send('PUT', '/remote/computers/c1', { handle: 'studio-pc', name: '' })).status).toBe(400)
        expect((await send('PUT', '/remote/computers/c1', { handle: 'studio-pc', name: 'S', settings: { mode: 'yolo' } })).status).toBe(400)
        expect(await readComputers()).toEqual([])
    })

    it('keeps an "always allow" once, for the computer it names', async () => {
        await send('PUT', '/remote/computers/c1', { handle: 'studio-pc', name: 'Studio PC' })
        await send('POST', '/remote/computers/c1/rules', { kind: 'program', program: 'ffmpeg' })
        await send('POST', '/remote/computers/c1/rules', { kind: 'program', program: 'ffmpeg' })
        await send('POST', '/remote/computers/c1/rules', { kind: 'folder', folder: '/Volumes/Rushes' })
        const res = await send('POST', '/remote/computers/c1/rules', { kind: 'screen' })
        expect((await res.json()).settings).toMatchObject({ allowedPrograms: ['ffmpeg'], allowedFolders: ['/Volumes/Rushes'], screenAlways: true })
        expect((await send('POST', '/remote/computers/c9/rules', { kind: 'screen' })).status).toBe(404)
        expect((await send('POST', '/remote/computers/c1/rules', { kind: 'program', program: '' })).status).toBe(400)
    })

    it('forgets an unlinked computer, and says so for one it never knew', async () => {
        await send('PUT', '/remote/computers/c1', { handle: 'studio-pc', name: 'Studio PC' })
        await send('PUT', '/remote/computers/c2', { handle: 'laptop', name: 'Laptop' })
        expect((await send('DELETE', '/remote/computers/c1')).status).toBe(200)
        expect((await readComputers()).map(c => c.id)).toEqual(['c2'])
        expect((await send('DELETE', '/remote/computers/c1')).status).toBe(404)
    })

    it('reads past an entry it cannot read, and a file that is not JSON as empty', async () => {
        await mkdir(remoteDir(), { recursive: true })
        await writeFile(remoteComputersPath(), JSON.stringify({ computers: [{ id: 'c1', handle: 'ok', name: 'Ok', capabilities: ['shell', 'teleport'], facts: { bogus: true } }, { id: 'c2' }] }), 'utf8')
        const [only, ...rest] = await readComputers()
        expect(rest).toEqual([])
        expect(only).toMatchObject({ id: 'c1', capabilities: ['shell'], facts: null })
        await writeFile(remoteComputersPath(), '{', 'utf8')
        expect(await readComputers()).toEqual([])
        await writeFile(remoteComputersPath(), '{"computers":{}}', 'utf8')
        expect(await readComputers()).toEqual([])
    })

    it('fails loudly on a file it cannot open, rather than reading it as empty', async () => {
        await mkdir(remoteComputersPath(), { recursive: true })
        expect((await send('GET', '/remote/computers')).status).toBe(500)
        expect(await readFile(remoteComputersPath()).catch(err => err.code)).toBe('EISDIR')
    })
})

describe('/remote/computers on a box where computers are off', () => {
    it('answers nothing', async () => {
        vi.resetModules()
        vi.stubEnv('RERUN_REMOTE_COMPUTERS', 'off')
        const { createServer: create } = await import('../server.js')
        const res = await create().request('/remote/computers')
        expect(res.status).toBe(404)
        vi.unstubAllEnvs()
    })
})
