import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { compileServiceParts } from './compiler'
import { type ServiceManifest, isPaidApp, serviceManifestSchema, takesSeveralAccounts, usesInstances } from './manifest'

vi.mock('@/app/api/_services/chat.service', () => ({ resolveAgentTarget: vi.fn() }))
vi.mock('@/lib/composio/client', () => ({ deleteConnectedAccount: vi.fn() }))

const NOTHING_TO_CONNECT = ['autodesk', 'clerk', 'crypto-com', 'godaddy', 'malwarebytes', 'microsoft', 'mozilla', 'nuxt', 'solana', 'trivago', 'ziprecruiter']

// Each row of the seed is one line of SQL literals, its manifest the first that is a JSON object.
function seededManifests(): ServiceManifest[] {
    const seed = readFileSync(fileURLToPath(new URL('../../../../supabase/seed.sql', import.meta.url)), 'utf8')
    return seed
        .split('\n')
        .filter(line => line.startsWith("('"))
        .flatMap(line => {
            const literal = [...line.matchAll(/'((?:[^']|'')*)'/g)].map(match => match[1].replaceAll("''", "'")).find(text => text.startsWith('{'))
            return literal ? [serviceManifestSchema.parse(JSON.parse(literal))] : []
        })
}

function paidManifest(slug: string, appSlug: string): ServiceManifest {
    const serverName = slug.replace('-', '_')
    return serviceManifestSchema.parse({ slug, name: slug, authMethods: [{ id: 'app', kind: 'app', app: { appSlug }, mcpServers: [{ name: serverName, transport: 'http', url: `\${RERUN_HUB_BASE_URL}/api/mcp/apps/${appSlug}` }] }] })
}

const catalog = [...seededManifests(), paidManifest('linkedin-pro', 'linkedin'), paidManifest('whatsapp-pro', 'whatsapp')]

function compiledAs(manifest: ServiceManifest, methodId: string, instanceId: string) {
    const method = manifest.authMethods.find(candidate => candidate.id === methodId)
    const values = Object.fromEntries((method?.inputs ?? []).map(input => [input.key, `${input.key}-of-${instanceId}`]))
    return compileServiceParts(manifest, values, methodId, '${RERUN_AGENT_ID}', { instanceId, label: `Account ${instanceId}` })
}

describe('the whole catalog', () => {
    it('is read from the seed', () => {
        expect(catalog.length).toBeGreaterThan(200)
    })

    it('lets a coworker hold several accounts of every app that has one', () => {
        expect(catalog.filter(manifest => !takesSeveralAccounts(manifest)).map(manifest => manifest.slug).sort()).toEqual(NOTHING_TO_CONNECT)
    })

    it('makes each account an instance, except for the paid apps, which keep one connector', () => {
        const single = catalog.filter(manifest => takesSeveralAccounts(manifest) && !usesInstances(manifest))
        expect(single.map(manifest => manifest.slug).sort()).toEqual(['linkedin-pro', 'whatsapp-pro'])
        expect(single.every(isPaidApp)).toBe(true)
    })

    // Lovable only lets the clients of its own list sign in to its MCP server, and Rerun is not one.
    it('connects Lovable with a key alone, and says what the key needs next to its field', () => {
        const lovable = catalog.find(manifest => manifest.slug === 'lovable')
        expect(lovable?.authMethods).toMatchObject([{ kind: 'key', mcpServers: [], inputs: [{ key: 'LOVABLE_API_KEY', secret: true, required: true }] }])
        expect(lovable?.authMethods[0].inputs[0].help).toMatch(/Business or Enterprise.*owner or admin.*cannot create a project/)
    })

    const compiled = catalog.filter(usesInstances).flatMap(manifest => manifest.authMethods.map(method => ({ slug: manifest.slug, methodId: method.id, manifest })))

    it.each(compiled)('keeps two accounts of $slug ($methodId) apart', ({ manifest, methodId }) => {
        const first = compiledAs(manifest, methodId, 'aaaaaa')
        const second = compiledAs(manifest, methodId, 'bbbbbb')

        const names = (parts: typeof first) => [...parts.servers.map(server => server.name), ...Object.keys(parts.env)]
        expect(names(first).filter(name => names(second).includes(name))).toEqual([])

        const sharedBodies = second.skills.filter(skill => first.skills.some(other => other.name === skill.name))
        for (const skill of sharedBodies) expect(first.skills.find(other => other.name === skill.name)?.body).toBe(skill.body)

        // A variable no server reads only reaches the model through a skill that names it.
        const servers = JSON.stringify(second.servers)
        const bodies = second.skills.map(skill => skill.body).join('\n')
        for (const [variable, value] of Object.entries(second.env)) if (!servers.includes(variable) && !servers.includes(value)) expect(bodies).toContain(variable)
        for (const value of Object.values(first.env)) expect(bodies).not.toContain(value)
    })
})
