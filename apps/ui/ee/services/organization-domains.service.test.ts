import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DnsResolver } from '@/ee/lib/organizations/domain-dns'
import { HAVRE, NORDLYS, organizationContext, organizationWorld, RIVAL, type OrganizationWorld } from '@/ee/test/organization-world'
import { writeMethodOf } from '@/test/supabase-fake'

const mocks = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@/lib/app-url', () => ({ APP_URL: 'https://app.rerun.build' }))
vi.mock('@rerun/cloud/organizations', () => ({ ORGANIZATIONS_ENABLED: true }))

const { addOrganizationDomain, checkOrganizationDomain, checkOrganizationDomains, isServedHostname, listOrganizationDomains, MAX_DOMAINS, removeOrganizationDomain, servedDomainHostnames } = await import('./organization-domains.service')
const { forgetOrganizationBrands, organizationOfHost } = await import('./organization-brand.service')

const EDGE = 'edge.rerun.work'
const HOST = 'app.acme.com'

let world: OrganizationWorld
let zone: Record<string, { cname?: string[]; txt?: string[] }>

const dns: DnsResolver = { cname: async name => zone[name]?.cname ?? [], a: async () => [], txt: async name => zone[name]?.txt ?? [] }
const ours = () => organizationContext(world)
const theirs = () => organizationContext(world, { organizationId: HAVRE, userId: RIVAL })
const domains = () => world.rows('organization_domains')
const row = (organizationId = NORDLYS) => domains().find(domain => domain.organization_id === organizationId && domain.hostname === HOST) as Record<string, string>
const point = (name = HOST) => {
    zone[name] = { ...zone[name], cname: [EDGE] }
}
const publish = (token: string, name = HOST) => {
    zone[`_verify.${name}`] = { txt: [...(zone[`_verify.${name}`]?.txt ?? []), token] }
}
const check = (ctx = ours(), id = row(ctx.organization.id).id) => {
    row(ctx.organization.id).last_checked_at = '2026-01-01T00:00:00Z'
    return checkOrganizationDomain(ctx, id, dns)
}

// The unique index of the active ones, which the fake database does not hold on an update.
function activeIsUnique(table: string, calls: readonly { method: string; args: unknown[] }[]) {
    if (table !== 'organization_domains' || writeMethodOf(calls as never) !== 'update') return
    const update = calls.find(call => call.method === 'update')!.args[0] as { status?: string }
    const id = calls.find(call => call.method === 'eq' && call.args[0] === 'id')!.args[1]
    const target = domains().find(domain => domain.id === id)
    if (update.status === 'active' && domains().some(domain => domain.id !== id && domain.status === 'active' && domain.hostname === target?.hostname)) return { error: { code: '23505', message: 'taken' } }
}

beforeEach(() => {
    vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', 'rerun.work')
    vi.stubEnv('PUBLISH_HOST', 'rerun.site')
    vi.stubEnv('ORGANIZATION_EDGE_IPS', '')
    zone = {}
    world = organizationWorld({ organization_domains: [] }, activeIsUnique)
    mocks.client = world.client
    forgetOrganizationBrands()
    return () => vi.unstubAllEnvs()
})

describe('adding a domain', () => {
    it('lists it with the two records to publish, waiting', async () => {
        await addOrganizationDomain(ours(), ' App.Acme.com. ')
        const { defaultHostname, domains: listed } = await listOrganizationDomains(ours())
        expect(defaultHostname).toBe('nordlys.rerun.work')
        expect(listed).toEqual([
            expect.objectContaining({
                hostname: HOST,
                status: 'pending',
                problem: null,
                records: [
                    { type: 'CNAME', name: HOST, value: EDGE },
                    { type: 'TXT', name: `_verify.${HOST}`, value: expect.stringMatching(/^verify-[0-9a-f]{40}$/) },
                ],
            }),
        ])
        expect((await listOrganizationDomains(theirs())).domains).toEqual([])
    })

    it.each(['', 'acme', 'https://app.acme.com', '10.0.0.1', 'a b.com'])('refuses %j, which is not a name', async raw => {
        await expect(addOrganizationDomain(ours(), raw)).rejects.toMatchObject({ code: 'domainInvalid' })
    })

    it.each(['app.rerun.build', 'nordlys.rerun.work', 'x.rerun.site', 'rerun.com'])('refuses %s, which is Rerun’s', async raw => {
        await expect(addOrganizationDomain(ours(), raw)).rejects.toMatchObject({ code: 'domainReserved' })
    })

    it('lets two organizations ask for the same one, each with its own token', async () => {
        await addOrganizationDomain(ours(), HOST)
        await addOrganizationDomain(theirs(), HOST)
        expect(row(NORDLYS).verification_token).not.toBe(row(HAVRE).verification_token)
    })

    it('refuses one another organization proved, and one already in its own list', async () => {
        await addOrganizationDomain(theirs(), HOST)
        row(HAVRE).status = 'active'
        await expect(addOrganizationDomain(ours(), HOST)).rejects.toMatchObject({ code: 'domainTaken' })
        world = organizationWorld({ organization_domains: [] }, (table, calls) => (table === 'organization_domains' && writeMethodOf(calls) === 'insert' ? { error: { code: '23505', message: 'duplicate' } } : undefined))
        await expect(addOrganizationDomain(ours(), HOST)).rejects.toMatchObject({ code: 'domainAlreadyAdded' })
    })

    it(`stops at ${MAX_DOMAINS}`, async () => {
        for (let i = 0; i < MAX_DOMAINS; i++) await addOrganizationDomain(ours(), `app${i}.acme.com`)
        await expect(addOrganizationDomain(ours(), HOST)).rejects.toMatchObject({ code: 'domainLimit', params: { max: MAX_DOMAINS } })
    })

    it('is refused where organizations have no address', async () => {
        vi.stubEnv('ORGANIZATION_ROOT_DOMAIN', '')
        await expect(addOrganizationDomain(ours(), HOST)).rejects.toMatchObject({ code: 'domainsUnavailable' })
        expect((await listOrganizationDomains(ours())).defaultHostname).toBeNull()
    })
})

describe('serving a domain', () => {
    beforeEach(() => addOrganizationDomain(ours(), HOST))

    it('starts once it points here and proves whose it is', async () => {
        point()
        publish(row().verification_token)
        await check()
        expect(row()).toMatchObject({ status: 'active', problem: null, verified_at: expect.any(String) })
        await expect(organizationOfHost({ kind: 'domain', hostname: HOST })).resolves.toMatchObject({ organizationId: NORDLYS })
    })

    it('shows at once where a minute ago it was nobody’s', async () => {
        await expect(organizationOfHost({ kind: 'domain', hostname: HOST })).resolves.toBeNull()
        point()
        publish(row().verification_token)
        await check()
        await expect(organizationOfHost({ kind: 'domain', hostname: HOST })).resolves.not.toBeNull()
    })

    it('does not start on the CNAME alone: a record left behind is whoever’s', async () => {
        point()
        await check()
        expect(row()).toMatchObject({ status: 'pending', problem: 'noToken' })
        expect(await isServedHostname(HOST)).toBe(false)
    })

    it('does not start on the proof alone', async () => {
        publish(row().verification_token)
        await check()
        expect(row()).toMatchObject({ status: 'pending', problem: 'noRecord' })
    })

    it('does not start on another organization’s token', async () => {
        await addOrganizationDomain(theirs(), HOST)
        point()
        publish(row(HAVRE).verification_token)
        await check()
        expect(row()).toMatchObject({ status: 'pending', problem: 'noToken' })
        await check(theirs())
        expect(row(HAVRE)).toMatchObject({ status: 'active' })
    })

    it('is the first one’s to prove it, whoever proves it after', async () => {
        await addOrganizationDomain(theirs(), HOST)
        point()
        publish(row(NORDLYS).verification_token)
        publish(row(HAVRE).verification_token)
        await check()
        await check(theirs())
        expect(row(NORDLYS).status).toBe('active')
        expect(row(HAVRE)).toMatchObject({ status: 'pending', problem: 'taken' })
        await expect(organizationOfHost({ kind: 'domain', hostname: HOST })).resolves.toMatchObject({ organizationId: NORDLYS })
    })

    it('goes to whoever proves it once the first let it go, never before', async () => {
        await addOrganizationDomain(theirs(), HOST)
        point()
        publish(row(NORDLYS).verification_token)
        await check()
        await removeOrganizationDomain(ours(), row(NORDLYS).id)
        // The CNAME is still there: it opens the door to nobody.
        await check(theirs())
        expect(row(HAVRE)).toMatchObject({ status: 'pending', problem: 'noToken' })
        await expect(organizationOfHost({ kind: 'domain', hostname: HOST })).resolves.toBeNull()
        publish(row(HAVRE).verification_token)
        await check(theirs())
        expect(row(HAVRE).status).toBe('active')
    })

    it('needs a new proof when it is added again', async () => {
        point()
        const old = row().verification_token
        publish(old)
        await check()
        await removeOrganizationDomain(ours(), row().id)
        await addOrganizationDomain(ours(), HOST)
        await check()
        expect(row().verification_token).not.toBe(old)
        expect(row()).toMatchObject({ status: 'pending', problem: 'noToken' })
    })

    it('does not ask the DNS again at each click', async () => {
        const asked = vi.spyOn(dns, 'cname')
        await check()
        await checkOrganizationDomain(ours(), row().id, dns)
        expect(asked).toHaveBeenCalledTimes(1)
        asked.mockRestore()
    })
})

describe('another organization’s domain', () => {
    it('answers like one that does not exist, and nothing changes', async () => {
        await addOrganizationDomain(theirs(), HOST)
        const before = JSON.stringify(domains())
        const { id } = row(HAVRE)
        await expect(checkOrganizationDomain(ours(), id, dns)).rejects.toMatchObject({ code: 'domainNotFound' })
        await expect(removeOrganizationDomain(ours(), id)).rejects.toMatchObject({ code: 'domainNotFound' })
        await expect(removeOrganizationDomain(ours(), '00000000-0000-4000-8000-00000000dead')).rejects.toMatchObject({ code: 'domainNotFound' })
        expect(JSON.stringify(domains())).toBe(before)
    })
})

describe('the hourly check', () => {
    const DAY = 24 * 60 * 60 * 1000
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    const seeded = (overrides: object) => ({ id: 'd', organization_id: NORDLYS, hostname: HOST, status: 'active', verification_token: 'verify-x', problem: null, failing_since: null, verified_at: ago(DAY), last_checked_at: null, created_at: ago(30 * DAY), ...overrides })

    it('serves what is ready and lets go of what has pointed elsewhere for a day', async () => {
        world = organizationWorld(
            {
                organization_domains: [
                    seeded({ id: 'kept', hostname: 'kept.acme.com' }),
                    seeded({ id: 'lost', hostname: 'lost.acme.com', failing_since: ago(DAY + 1000) }),
                    seeded({ id: 'failing', hostname: 'failing.acme.com' }),
                    seeded({ id: 'ready', hostname: 'ready.acme.com', status: 'pending', created_at: ago(1000) }),
                    seeded({ id: 'forgotten', hostname: 'forgotten.acme.com', status: 'pending', created_at: ago(8 * DAY) }),
                ],
            },
            activeIsUnique,
        )
        point('kept.acme.com')
        point('ready.acme.com')
        publish('verify-x', 'ready.acme.com')
        point('forgotten.acme.com')
        publish('verify-x', 'forgotten.acme.com')

        await expect(checkOrganizationDomains(world.client, dns)).resolves.toEqual({ checked: 4, activated: ['ready.acme.com'], lost: ['lost.acme.com'], failed: [] })
        expect(Object.fromEntries(domains().map(domain => [domain.id, domain.status]))).toEqual({ kept: 'active', lost: 'error', failing: 'active', ready: 'active', forgotten: 'pending' })
        expect(domains().find(domain => domain.id === 'failing')).toMatchObject({ problem: 'noRecord', failing_since: expect.any(String) })
    })

    it('goes on past one that could not be written', async () => {
        world = organizationWorld({ organization_domains: [seeded({ id: 'a', hostname: 'a.acme.com' }), seeded({ id: 'b', hostname: 'b.acme.com' })] }, (table, calls) =>
            table === 'organization_domains' && writeMethodOf(calls) === 'update' && calls.some(call => call.args[1] === 'a') ? { error: { message: 'down' } } : undefined,
        )
        await expect(checkOrganizationDomains(world.client, dns)).resolves.toMatchObject({ checked: 1, failed: ['a.acme.com: down'] })
    })
})

describe('the names the edge may get a certificate for', () => {
    it('are the default addresses, a suspended organization’s included, and the domains being served', async () => {
        world = organizationWorld({ organization_domains: [{ id: 'd', organization_id: NORDLYS, hostname: HOST, status: 'active', created_at: '1' }, { id: 'e', organization_id: NORDLYS, hostname: 'old.acme.com', status: 'error', created_at: '1' }] })
        world.rows('organizations')[1].status = 'suspended'
        mocks.client = world.client
        for (const name of ['nordlys.rerun.work', 'havre.rerun.work', HOST]) expect(await isServedHostname(name), name).toBe(true)
        for (const name of ['nobody.rerun.work', 'rerun.work', 'edge.rerun.work', 'a.nordlys.rerun.work', 'old.acme.com', 'acme.com', 'app.rerun.build', 'localhost', '10.0.0.1', '', 'App.Acme.com', 'app.acme.com.', 'app.acme.com:443', 'x'.repeat(500)]) expect(await isServedHostname(name), name).toBe(false)
    })
})

describe('the domains Traefik hands to the edge', () => {
    it('are the active ones, one still answered for a day included, and every one gets its certificate', async () => {
        world = organizationWorld({
            organization_domains: [
                { id: 'd', organization_id: NORDLYS, hostname: HOST, status: 'active', created_at: '1' },
                { id: 'f', organization_id: HAVRE, hostname: 'portal.havre.io', status: 'active', failing_since: '2026-01-01T00:00:00Z', created_at: '2' },
                { id: 'e', organization_id: NORDLYS, hostname: 'old.acme.com', status: 'error', created_at: '3' },
                { id: 'p', organization_id: NORDLYS, hostname: 'next.acme.com', status: 'pending', created_at: '4' },
            ],
        })
        mocks.client = world.client
        const served = await servedDomainHostnames(world.client)
        expect(served).toEqual([HOST, 'portal.havre.io'])
        for (const name of served) expect(await isServedHostname(name), name).toBe(true)
    })
})
