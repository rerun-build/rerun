import { createHash, createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fakeSupabase, writeMethodOf, type FakeSupabase, type SupabaseCall } from '@/test/supabase-fake'

vi.mock('server-only', () => ({}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/engine/client', () => ({ supportsRemoteComputers: vi.fn() }))
vi.mock('@/lib/engine/remote-client', () => ({ upsertRemoteComputer: vi.fn(), deleteRemoteComputer: vi.fn(), listRemoteComputers: vi.fn(), addRemoteComputerRule: vi.fn() }))
vi.mock('@rerun/cloud/engines', () => ({ DESKTOP_DIRECT: false, desktopRelayBase: vi.fn(async (_base: string, hostId: string | null, boxIndex: number | null) => (hostId ? `wss://${hostId}.relay.test/box/${10 + (boxIndex ?? 0)}` : null)) }))

const { createServiceRoleClient } = await import('@/supabase/serviceRole')
const { supportsRemoteComputers } = await import('@/lib/engine/client')
const { upsertRemoteComputer, deleteRemoteComputer, listRemoteComputers, addRemoteComputerRule } = await import('@/lib/engine/remote-client')
const service = await import('./remote-computers.service')

const hash = (token: string) => createHash('sha256').update(token).digest('hex')

type Row = Record<string, unknown>

let db: FakeSupabase
let computers: Row[]
let members: Row[]
let pool: Row | null
let takenHandles: Set<string>

const filterOf = (calls: readonly SupabaseCall[], column: string) => calls.find(call => (call.method === 'eq' || call.method === 'is') && call.args[0] === column)?.args[1]

function matching(calls: readonly SupabaseCall[], rows: Row[]): Row[] {
    return rows.filter(row => calls.every(call => (call.method !== 'eq' && call.method !== 'is') || row[call.args[0] as string] === call.args[1]))
}

beforeEach(() => {
    vi.clearAllMocks()
    computers = []
    members = [{ workspace_id: 7, user_id: 'u1' }]
    pool = { engine_host: 'http://10.0.0.9:3000', engine_api_key: 'box-key', host_id: 'rerun-host-01', box_index: 3 }
    takenHandles = new Set()
    db = fakeSupabase((table, calls) => {
        if (table === 'engine_pool') return { data: pool }
        if (table === 'workspace_members') return { data: matching(calls, members)[0] ?? null }
        if (table !== 'remote_computers') return undefined
        const write = writeMethodOf(calls)
        if (write === 'insert') {
            const payload = calls.find(call => call.method === 'insert')!.args[0] as Row
            if (takenHandles.has(payload.handle as string)) return { data: null, error: { code: '23505', message: 'duplicate' } }
            const row = { id: `c${computers.length + 1}`, created_at: new Date().toISOString(), revoked_at: null, ...payload }
            computers.push(row)
            return { data: row }
        }
        if (write === 'update') {
            const payload = calls.find(call => call.method === 'update')!.args[0] as Row
            for (const row of matching(calls, computers)) Object.assign(row, payload)
            return { data: null }
        }
        const found = matching(calls, computers)
        return { data: calls.some(call => call.method === 'maybeSingle' || call.method === 'single') ? (found[0] ?? null) : found }
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(db.client)
    vi.mocked(supportsRemoteComputers).mockResolvedValue(true)
    vi.mocked(upsertRemoteComputer).mockImplementation(async (_conn, id, body) => ({ id, handle: body.handle, name: body.name, online: false }) as never)
    vi.mocked(deleteRemoteComputer).mockResolvedValue(undefined)
})

const link = (overrides: Partial<Parameters<typeof service.linkComputer>[0]> = {}) => service.linkComputer({ workspaceId: 7, userId: 'u1', name: 'Studio PC', os: 'mac', arch: 'arm64', hostname: 'studio.local', appVersion: '0.2.0', ...overrides })

describe('linkComputer', () => {
    it('keeps only the hash of a token shown once, and tells the engine of the computer', async () => {
        const { computer, token } = await link()
        expect(token).toMatch(/^rrn_computer_[\w-]{40,}$/)
        expect(computer).toMatchObject({ workspace_id: 7, name: 'Studio PC', handle: 'studio-pc', os: 'mac', linked_by: 'u1', token_hash: hash(token) })
        expect(JSON.stringify(db.writes('remote_computers'))).not.toContain(token)
        expect(upsertRemoteComputer).toHaveBeenCalledWith({ baseUrl: 'http://10.0.0.9:3000', apiKey: 'box-key' }, 'c1', { handle: 'studio-pc', name: 'Studio PC' })
    })

    it('numbers a handle another computer of the workspace already has', async () => {
        takenHandles.add('studio-pc')
        takenHandles.add('studio-pc-2')
        expect((await link()).computer.handle).toBe('studio-pc-3')
    })

    it('gives a name with no letter a handle anyway, and refuses an empty or endless name', async () => {
        expect((await link({ name: '电脑' })).computer.handle).toBe('computer')
        await expect(link({ name: '   ' })).rejects.toMatchObject({ code: 'computerNameInvalid' })
        await expect(link({ name: 'x'.repeat(101) })).rejects.toMatchObject({ code: 'computerNameInvalid' })
    })

    it('links a computer even when the box cannot be told yet', async () => {
        vi.mocked(upsertRemoteComputer).mockRejectedValue(new Error('down'))
        await expect(link()).resolves.toMatchObject({ computer: { handle: 'studio-pc' } })
        vi.mocked(supportsRemoteComputers).mockResolvedValue(false)
        await expect(link({ name: 'Laptop' })).resolves.toMatchObject({ computer: { handle: 'laptop' } })
    })
})

function ticketClaims(socketUrl: string): Record<string, unknown> {
    const ticket = decodeURIComponent(new URL(socketUrl).searchParams.get('ticket')!)
    const [payload, signature] = ticket.split('.')
    expect(signature).toBe(createHmac('sha256', 'box-key').update(payload).digest('base64url'))
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
}

describe('connectComputer', () => {
    it('answers the relay of the box with a ticket that names the computer, and notes the visit', async () => {
        const { token } = await link()
        const { socketUrl, computer } = await service.connectComputer(token, '0.2.1')
        expect(socketUrl.startsWith('wss://rerun-host-01.relay.test/box/13/remote/ws?ticket=')).toBe(true)
        expect(ticketClaims(socketUrl)).toMatchObject({ aud: 'remote', computer: { id: 'c1', handle: 'studio-pc', name: 'Studio PC' } })
        expect(computer).toEqual({ id: 'c1', handle: 'studio-pc', name: 'Studio PC' })
        expect(computers[0]).toMatchObject({ app_version: '0.2.1', last_seen_at: expect.any(String) })
    })

    it('reaches an engine on this machine directly', async () => {
        pool = { ...pool, engine_host: 'http://localhost:3000', host_id: null }
        const { token } = await link()
        expect((await service.connectComputer(token, null)).socketUrl.startsWith('ws://localhost:3000/remote/ws?ticket=')).toBe(true)
    })

    it('refuses a token it never issued, or not shaped like one', async () => {
        await link()
        await expect(service.connectComputer('rrn_computer_forged', null)).rejects.toMatchObject({ reason: 'invalid', status: 401 })
        await expect(service.connectComputer('rrn_pair_abc', null)).rejects.toMatchObject({ reason: 'invalid', status: 401 })
    })

    it('refuses an unlinked computer for good', async () => {
        const { token, computer } = await link()
        await service.revokeComputer(7, computer.id)
        await expect(service.connectComputer(token, null)).rejects.toMatchObject({ reason: 'revoked', status: 401 })
    })

    it('unlinks the computer of a person who left the workspace, and tells the box', async () => {
        const { token } = await link()
        members = []
        await expect(service.connectComputer(token, null)).rejects.toMatchObject({ reason: 'revoked' })
        expect(computers[0].revoked_at).toEqual(expect.any(String))
        expect(deleteRemoteComputer).toHaveBeenCalledWith(expect.anything(), 'c1')
    })

    it('never vouches for a computer of one workspace on the box of another', async () => {
        const { token } = await link()
        await link({ workspaceId: 8, name: 'Other' })
        members.push({ workspace_id: 8, user_id: 'u1' })
        const engines: string[] = []
        vi.mocked(createServiceRoleClient).mockReturnValue(
            fakeSupabase((table, calls) => {
                if (table === 'engine_pool') {
                    engines.push(String(filterOf(calls, 'claimed_by_workspace_id')))
                    return { data: { ...pool, engine_host: `http://box-of-${filterOf(calls, 'claimed_by_workspace_id')}:3000` } }
                }
                if (table === 'workspace_members') return { data: matching(calls, members)[0] ?? null }
                return { data: matching(calls, computers)[0] ?? null }
            }).client,
        )
        const { computer } = await service.connectComputer(token, null)
        expect(computer.id).toBe('c1')
        expect(engines).toEqual(['7'])
    })

    it('asks the app to come back later while the box cannot take computers', async () => {
        const { token } = await link()
        pool = null
        await expect(service.connectComputer(token, null)).rejects.toMatchObject({ reason: 'no-engine', status: 503 })
        pool = { engine_host: 'http://10.0.0.9:3000', engine_api_key: 'k', host_id: null, box_index: null }
        await expect(service.connectComputer(token, null)).rejects.toMatchObject({ reason: 'unreachable', status: 503 })
        vi.mocked(supportsRemoteComputers).mockResolvedValue(false)
        await expect(service.connectComputer(token, null)).rejects.toMatchObject({ reason: 'engine-update', status: 503 })
    })
})

describe('managing a computer', () => {
    it('renames it without touching its handle', async () => {
        const { computer } = await link()
        await service.renameComputer(7, computer.id, '  Edit   suite ')
        expect(computers[0]).toMatchObject({ name: 'Edit suite', handle: 'studio-pc' })
        expect(upsertRemoteComputer).toHaveBeenLastCalledWith(expect.anything(), 'c1', { handle: 'studio-pc', name: 'Edit suite' })
    })

    it('refuses to touch a computer of another workspace or one already unlinked', async () => {
        const { computer } = await link()
        await expect(service.renameComputer(8, computer.id, 'Mine')).rejects.toMatchObject({ code: 'computerNotFound' })
        await service.revokeComputer(7, computer.id)
        await expect(service.updateComputerSettings(7, computer.id, { mode: 'ask' })).rejects.toMatchObject({ code: 'computerNotFound' })
    })

    it('sends the settings and the rules to the box, which enforces them', async () => {
        const { computer } = await link()
        vi.mocked(addRemoteComputerRule).mockResolvedValue({ id: 'c1' } as never)
        await service.updateComputerSettings(7, computer.id, { unattended: false })
        expect(upsertRemoteComputer).toHaveBeenLastCalledWith(expect.anything(), 'c1', { handle: 'studio-pc', name: 'Studio PC', settings: { unattended: false } })
        await service.addComputerRule(7, computer.id, { kind: 'program', program: 'ffmpeg' })
        expect(addRemoteComputerRule).toHaveBeenCalledWith(expect.anything(), 'c1', { kind: 'program', program: 'ffmpeg' })
    })

    it('says why settings cannot be changed on a workspace with no machine or an old one', async () => {
        const { computer } = await link()
        vi.mocked(supportsRemoteComputers).mockResolvedValue(false)
        await expect(service.updateComputerSettings(7, computer.id, { mode: 'ask' })).rejects.toMatchObject({ code: 'computersNeedEngineUpdate' })
        pool = null
        await expect(service.updateComputerSettings(7, computer.id, { mode: 'ask' })).rejects.toMatchObject({ code: 'computersNeedMachine' })
    })

    it('unlinks every computer of a member who leaves, and none of the others', async () => {
        await link()
        await link({ userId: 'u2', name: 'Laptop' })
        await service.revokeMemberComputers(7, 'u1')
        expect(computers.map(row => [row.handle, row.revoked_at !== null])).toEqual([
            ['studio-pc', true],
            ['laptop', false],
        ])
    })
})

describe('listWorkspaceComputers', () => {
    it('reads each computer with what the box says of it now, and registers one the box missed', async () => {
        await link()
        await link({ name: 'Laptop' })
        vi.mocked(listRemoteComputers).mockResolvedValue([{ id: 'c1', online: true } as never])
        const { computers: listed, engine } = await service.listWorkspaceComputers(7)
        expect(engine).toBe('ok')
        expect(listed.map(row => [row.handle, row.view?.online])).toEqual([
            ['studio-pc', true],
            ['laptop', false],
        ])
    })

    it('reads every computer offline when the box does not answer, is too old, or is missing', async () => {
        await link()
        vi.mocked(listRemoteComputers).mockRejectedValue(new Error('timeout'))
        expect(await service.listWorkspaceComputers(7)).toMatchObject({ engine: 'unreachable', computers: [{ view: null }] })
        vi.mocked(supportsRemoteComputers).mockResolvedValue(false)
        expect(await service.listWorkspaceComputers(7)).toMatchObject({ engine: 'needs-update', computers: [{ view: null }] })
        pool = null
        expect(await service.listWorkspaceComputers(7)).toMatchObject({ engine: 'none', computers: [{ view: null }] })
    })
})
