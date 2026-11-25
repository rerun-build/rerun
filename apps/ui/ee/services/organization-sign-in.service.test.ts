import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ADMIN, CLIENT, CLIENT_ADMIN, EMAILS, HAVRE, memberRow, NORDLYS, organizationTables, OWNER, RIVAL_CLIENT, RIVAL_WORKSPACE, STRANGER } from '@/ee/test/organization-world'
import { memoryDatabase, type MemoryDatabase, type MemoryTables } from '@/ee/test/memory-database'

const mocks = vi.hoisted(() => ({
    client: null as unknown,
    after: [] as (() => Promise<unknown>)[],
    sent: vi.fn(),
    createUser: vi.fn(),
    generateLink: vi.fn(),
    live: null as string | null,
    resend: vi.fn(),
    remember: vi.fn(),
    refuse: null as string | null,
}))
vi.mock('next/server', () => ({ after: (task: () => Promise<unknown>) => void mocks.after.push(task) }))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => mocks.client }))
vi.mock('@rerun/cloud/email', () => ({ sendSignInCodeEmail: mocks.sent }))
vi.mock('@/app/api/_services/sign-in-code.service', () => ({
    SIGN_IN_CODE_TTL_MINUTES: 15,
    accountOfLiveCode: async () => mocks.live,
    resendSignInCodeIfLive: mocks.resend,
    rememberSignInCode: mocks.remember,
    signInUrlFor: (hash: string, type: string, brand: Brand) => `${brand.appUrl}/auth/confirm?token_hash=${hash}&type=${type}`,
}))

const { askInvitedSignInCode } = await import('./organization-sign-in.service')

const BRAND: Brand = { ...RERUN_BRAND, organizationId: NORDLYS, name: 'Nordlys', appUrl: 'https://app.nordlys.no' }
const soon = () => new Date(Date.now() + 3_600_000).toISOString()
const past = () => new Date(Date.now() - 1000).toISOString()

let db: MemoryDatabase
let accounts: Record<string, string>

function world(overrides: MemoryTables = {}) {
    db = memoryDatabase(organizationTables(overrides), {
        before: (table, calls) => {
            if (table === 'rpc:claim_email_sign_up') return { data: (calls[0].args[1] as { p_ip: string }).p_ip !== mocks.refuse }
            if (table === 'rpc:check_email_exists') return { data: (calls[0].args[1] as { email: string }).email in accounts }
        },
    })
    const getUserById = async (id: string) => ({ data: { user: Object.entries(accounts).find(([, owner]) => owner === id) ? { id, email: Object.entries(accounts).find(([, owner]) => owner === id)![0], identities: [] } : null } })
    Object.assign(db.client, { auth: { admin: { createUser: mocks.createUser, generateLink: mocks.generateLink, getUserById } } })
    mocks.client = db.client
}

const ask = async (email: string, organizationId = NORDLYS) => {
    const outcome = await askInvitedSignInCode({ organizationId, brand: BRAND, email, ip: '203.0.113.7', locale: 'fr' })
    for (const task of mocks.after.splice(0)) await task()
    return outcome
}
const invitation = (email: string, overrides: object = {}) => ({ id: `i-${email}`, workspace_id: CLIENT, email, status: 'pending', expires_at: soon(), ...overrides })
const teamInvitation = (email: string, overrides: object = {}) => ({ id: `t-${email}`, organization_id: NORDLYS, email, status: 'pending', expires_at: soon(), ...overrides })

beforeEach(() => {
    vi.clearAllMocks()
    mocks.after = []
    mocks.live = null
    mocks.refuse = null
    accounts = Object.fromEntries(Object.entries(EMAILS).map(([id, email]) => [email, id]))
    mocks.sent.mockResolvedValue({ ok: true, id: 'e' })
    mocks.resend.mockResolvedValue('sent')
    mocks.createUser.mockImplementation(async ({ email }: { email: string }) => {
        accounts[email] = `new-${email}`
        return { data: {}, error: null }
    })
    mocks.generateLink.mockImplementation(async ({ email }: { email: string }) => ({ data: { user: { id: accounts[email], email }, properties: { email_otp: '123456', hashed_token: 'hash', verification_type: 'magiclink' } }, error: null }))
    world()
})

describe('who a code is mailed to', () => {
    it.each([
        ['a member of one of its workspaces', EMAILS[CLIENT_ADMIN]],
        ['its owner', EMAILS[OWNER]],
        ['an admin of its team', EMAILS[ADMIN]],
    ])('%s', async (_who, email) => {
        expect(await ask(email)).toBe('asked')
        expect(mocks.sent).toHaveBeenCalledExactlyOnceWith({ to: email, code: '123456', signInUrl: 'https://app.nordlys.no/auth/confirm?token_hash=hash&type=magiclink', expiresInMinutes: 15, locale: 'fr', brand: BRAND })
        expect(mocks.remember).toHaveBeenCalledWith({ email, userId: accounts[email], type: 'magiclink', code: '123456', tokenHash: 'hash' })
        expect(mocks.createUser).not.toHaveBeenCalled()
    })

    it('someone it invited to a workspace, whose account is opened', async () => {
        world({ workspace_invitations: [invitation('new@acme.test')] })
        await ask('new@acme.test')
        expect(mocks.createUser).toHaveBeenCalledExactlyOnceWith({ email: 'new@acme.test' })
        expect(mocks.sent).toHaveBeenCalledTimes(1)
    })

    it('someone it invited to its team', async () => {
        world({ organization_invitations: [teamInvitation('new@nordlys.test')] })
        await ask('new@nordlys.test')
        expect(mocks.sent).toHaveBeenCalledTimes(1)
    })

    it('a customer of Rerun it invited, whose account stays theirs', async () => {
        world({ workspace_invitations: [invitation(EMAILS[STRANGER])] })
        await ask(EMAILS[STRANGER])
        expect(mocks.createUser).not.toHaveBeenCalled()
        expect(mocks.sent).toHaveBeenCalledTimes(1)
    })

    it('someone whose account two tabs open at once', async () => {
        world({ workspace_invitations: [invitation('new@acme.test')] })
        mocks.createUser.mockImplementation(async ({ email }: { email: string }) => {
            accounts[email] = 'raced'
            return { data: {}, error: { code: 'email_exists', message: 'taken' } }
        })
        await ask('new@acme.test')
        expect(mocks.sent).toHaveBeenCalledTimes(1)
    })
})

describe('who it is not mailed to', () => {
    it.each([
        ['an address nobody knows', 'nobody@else.test', {}],
        ['a customer of Rerun', EMAILS[STRANGER], {}],
        ['a client of another organization', EMAILS[RIVAL_CLIENT], {}],
        ['someone another organization invited', 'new@rival.test', { workspace_invitations: [invitation('new@rival.test', { workspace_id: RIVAL_WORKSPACE })] }],
        ['someone invited to the team of another', 'new@havre.test', { organization_invitations: [teamInvitation('new@havre.test', { organization_id: HAVRE })] }],
        ['an invitation that expired', 'late@acme.test', { workspace_invitations: [invitation('late@acme.test', { expires_at: past() })] }],
        ['an invitation that was revoked', 'gone@acme.test', { workspace_invitations: [invitation('gone@acme.test', { status: 'revoked' })] }],
        ['a team invitation that expired', 'late@nordlys.test', { organization_invitations: [teamInvitation('late@nordlys.test', { expires_at: past() })] }],
        ['someone removed from its workspaces', EMAILS[CLIENT_ADMIN], { workspace_members: [memberRow(CLIENT_ADMIN, RIVAL_WORKSPACE)] }],
    ])('%s', async (_who, email, overrides) => {
        world(overrides)
        expect(await ask(email)).toBe('asked')
        expect(mocks.sent).not.toHaveBeenCalled()
        expect(mocks.createUser).not.toHaveBeenCalled()
        expect(mocks.generateLink).not.toHaveBeenCalled()
        expect(mocks.remember).not.toHaveBeenCalled()
        expect(mocks.resend).not.toHaveBeenCalled()
    })
})

describe('what the answer says', () => {
    it('is the same, as soon, whoever is asked about', async () => {
        world({ workspace_invitations: [invitation('new@acme.test')] })
        const reads: number[] = []
        for (const email of [EMAILS[CLIENT_ADMIN], 'new@acme.test', EMAILS[STRANGER], 'nobody@else.test']) {
            const before = db.chains.length
            expect(await askInvitedSignInCode({ organizationId: NORDLYS, brand: BRAND, email, ip: '203.0.113.7', locale: 'en' })).toBe('asked')
            reads.push(db.chains.length - before)
        }
        expect(new Set(reads)).toEqual(new Set([2]))
        expect(mocks.generateLink).not.toHaveBeenCalled()
        expect(mocks.after).toHaveLength(4)
    })

    it.each([
        ['the network', 'code:203.0.113.7'],
        ['the address', `host:${NORDLYS}:${EMAILS[CLIENT_ADMIN]}`],
    ])('is too many once %s asked too often, invited or not', async (_who, key) => {
        mocks.refuse = key
        expect(await ask(EMAILS[CLIENT_ADMIN])).toBe('too_many')
        expect(mocks.sent).not.toHaveBeenCalled()
    })

    it('counts an address nobody knows like any other', async () => {
        mocks.refuse = `host:${NORDLYS}:nobody@else.test`
        expect(await ask('nobody@else.test')).toBe('too_many')
    })

    it('does not turn into an error when the mail fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        mocks.generateLink.mockResolvedValue({ data: { user: null, properties: null }, error: { message: 'down' } })
        expect(await ask(EMAILS[CLIENT_ADMIN])).toBe('asked')
    })
})

describe('a code that is still good', () => {
    it('is mailed again under the brand of the host, and no other is minted', async () => {
        mocks.live = CLIENT_ADMIN
        await ask(EMAILS[CLIENT_ADMIN])
        expect(mocks.resend).toHaveBeenCalledExactlyOnceWith(EMAILS[CLIENT_ADMIN], null, BRAND)
        expect(mocks.generateLink).not.toHaveBeenCalled()
    })

    it('is replaced when it can no longer be mailed', async () => {
        mocks.live = CLIENT_ADMIN
        mocks.resend.mockResolvedValue(null)
        await ask(EMAILS[CLIENT_ADMIN])
        expect(mocks.sent).toHaveBeenCalledTimes(1)
    })

    it('is neither mailed nor voided for someone the organization does not know', async () => {
        mocks.live = STRANGER
        await ask(EMAILS[STRANGER])
        expect(mocks.resend).not.toHaveBeenCalled()
        expect(mocks.generateLink).not.toHaveBeenCalled()
    })
})
