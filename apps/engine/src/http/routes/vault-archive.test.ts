import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-vault-archive-'))
process.env.RERUN_API_KEY = ''
process.env.RERUN_HUB_BASE_URL = ''

const { beforeAll, describe, expect, it } = await import('vitest')
const { readFile, readdir, writeFile } = await import('node:fs/promises')
const { extract } = await import('tar')
const { createServer } = await import('../server.js')
const { migrate } = await import('../../db/migrate.js')
const { skillsDir } = await import('../../config/paths.js')

const app = createServer()

const SECRET = 'lin_api_never_in_an_archive'
const STRIPE = 'sk_live_never_in_an_archive'

function send(method: string, path: string, body?: unknown) {
    return app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function created<T>(res: Response): Promise<T> {
    expect(res.status).toBe(201)
    return (await res.json()) as T
}

async function unpack(bytes: ArrayBuffer): Promise<string> {
    const dir = mkdtempSync(resolve(tmpdir(), 'rerun-vault-unpack-'))
    const file = resolve(dir, 'archive.tar.gz')
    await writeFile(file, Buffer.from(bytes))
    await extract({ file, cwd: dir })
    return dir
}

async function filesUnder(root: string, prefix = ''): Promise<string[]> {
    const out: string[] = []
    for (const entry of await readdir(resolve(root, prefix), { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) out.push(...(await filesUnder(root, path)))
        else out.push(path)
    }
    return out
}

type Item = { id: string; agentIds: string[] }

let agentId = ''
let linear: Item
let stripe: Item

beforeAll(async () => {
    await migrate()
    agentId = (await created<{ id: string }>(await send('POST', '/agents', { config: { name: 'seller' } }))).id
    linear = await created<Item>(
        await send('POST', '/vault', {
            kind: 'service',
            slug: 'linear',
            name: 'Linear',
            label: 'ops@acme.test',
            mcpServers: [{ name: 'linear', transport: 'http', url: 'https://mcp.linear.app/mcp', headers: { Authorization: 'Bearer ${LINEAR_API_KEY}' } }],
            skills: [{ slug: 'linear-triage', name: 'Linear triage', body: 'Triage the inbox.' }],
            env: { LINEAR_API_KEY: SECRET },
            agentIds: [agentId],
        }),
    )
    stripe = await created<Item>(await send('POST', '/vault', { kind: 'secret', name: 'Stripe key', env: { STRIPE_API_KEY: STRIPE }, agentIds: [agentId] }))
})

describe('an archive of a coworker holding Vault entries', () => {
    it('carries them as its own, with no value and no Vault id', async () => {
        const plan = (await (await send('GET', `/agents/${agentId}/archive/plan`)).json()) as { connectorSlugs: string[]; envKeys: string[]; files: { path: string }[] }
        expect(plan.connectorSlugs).toContain('linear')
        expect(plan.envKeys).toEqual(expect.arrayContaining(['LINEAR_API_KEY', 'STRIPE_API_KEY']))
        expect(plan.files.map(file => file.path)).not.toContain('skills/.vault-skills.json')

        const res = await send('GET', `/agents/${agentId}/archive`)
        expect(res.status).toBe(200)
        const dir = await unpack(await res.arrayBuffer())
        const files = await filesUnder(dir)
        expect(files).toContain('skills/linear-triage/SKILL.md')
        expect(files).not.toContain('skills/.vault-skills.json')

        const everything = (await Promise.all(files.filter(file => !file.endsWith('.gz') && !file.endsWith('.db')).map(file => readFile(resolve(dir, file), 'utf8')))).join('\n')
        expect(everything).not.toContain(SECRET)
        expect(everything).not.toContain(STRIPE)
        expect(everything).not.toContain(linear.id)
        expect(everything).not.toContain(stripe.id)
        expect(everything).not.toContain('vaultItemId')

        const config = JSON.parse(await readFile(resolve(dir, 'config.json'), 'utf8')) as { mcpServers: { name: string; headers: Record<string, string> }[] }
        expect(config.mcpServers.find(server => server.name === 'linear')?.headers.Authorization).toBe('Bearer ${LINEAR_API_KEY}')

        const env = await readFile(resolve(dir, '.env'), 'utf8')
        expect(env).toContain('LINEAR_API_KEY=')
        expect(env).toContain('STRIPE_API_KEY=')

        const registry = JSON.parse(await readFile(resolve(dir, 'workspace/.rerun/services.json'), 'utf8')) as { services: Record<string, { status: string; envKeys: string[]; skills: string[] }> }
        expect(registry.services.linear).toMatchObject({ status: 'needs_config', envKeys: ['LINEAR_API_KEY'], skills: ['linear-triage'] })
    })

    it('arrives on another coworker attached to nothing', async () => {
        const archive = await send('GET', `/agents/${agentId}/archive`)
        const imported = await created<{ id: string }>(await app.request('/agents/import?name=seller_copy', { method: 'POST', body: await archive.arrayBuffer() }))
        const items = ((await (await send('GET', '/vault')).json()) as { items: Item[] }).items
        expect(items.every(item => !item.agentIds.includes(imported.id))).toBe(true)
        expect(existsSync(resolve(skillsDir(imported.id), '.vault-skills.json'))).toBe(false)
        expect(existsSync(resolve(skillsDir(imported.id), 'linear-triage', 'SKILL.md'))).toBe(true)
    })

    it('ignores the marker of an archive made by an engine that still packed it', async () => {
        const { importAgent } = await import('../../agents/import.js')
        const { create } = await import('tar')
        const { Readable } = await import('node:stream')
        const { createReadStream } = await import('node:fs')
        const { mkdir } = await import('node:fs/promises')
        const scratch = mkdtempSync(resolve(tmpdir(), 'rerun-vault-old-'))
        const payload = resolve(scratch, 'payload')
        await mkdir(resolve(payload, 'skills', 'linear-triage'), { recursive: true })
        await writeFile(resolve(payload, 'config.json'), JSON.stringify({ name: 'old' }))
        await writeFile(resolve(payload, 'skills', 'linear-triage', 'SKILL.md'), '---\nname: Linear triage\ndescription: x\n---\nTriage.\n')
        await writeFile(resolve(payload, 'skills', '.vault-skills.json'), JSON.stringify({ 'linear-triage': linear.id }))
        const file = resolve(scratch, 'old.tar.gz')
        await create({ gzip: true, cwd: payload, portable: true, file }, ['.'])
        const result = await importAgent({ body: Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>, name: 'old_copy' })
        expect(existsSync(resolve(skillsDir(result.id), '.vault-skills.json'))).toBe(false)
        expect(existsSync(resolve(skillsDir(result.id), 'linear-triage', 'SKILL.md'))).toBe(true)
    })
})

describe('a duplicate on the same box', () => {
    it('holds the Vault entries the coworker held', async () => {
        const copy = await created<{ id: string }>(await send('POST', `/agents/${agentId}/duplicate`, { name: 'seller_twin' }))
        const items = ((await (await send('GET', '/vault')).json()) as { items: Item[] }).items
        expect(items.find(item => item.id === linear.id)?.agentIds).toEqual(expect.arrayContaining([agentId, copy.id]))
        expect(items.find(item => item.id === stripe.id)?.agentIds).toEqual(expect.arrayContaining([agentId, copy.id]))
        const marker = JSON.parse(await readFile(resolve(skillsDir(copy.id), '.vault-skills.json'), 'utf8')) as Record<string, string>
        expect(marker['linear-triage']).toBe(linear.id)
    })
})
