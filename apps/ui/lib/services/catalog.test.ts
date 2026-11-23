import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { compileServiceParts } from './compiler'
import { type ServiceManifest, serviceManifestSchema, takesSeveralAccounts, usesInstances } from './manifest'

vi.mock('@/app/api/_services/chat.service', () => ({ getAgentChatTarget: vi.fn() }))
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

const catalog = seededManifests()

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
