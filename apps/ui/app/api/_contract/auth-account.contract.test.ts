import { mobileApi, signInRefusalSchema } from '@rerun/contracts'
import type { GenerateLinkResponse, Session, SupabaseClient, User, UserResponse } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthorizationError } from '@/app/api/_auth/errors'
import type { WorkspaceContext } from '@/app/api/_auth/ownership'
import type { Database } from '@/app/api/database.types'
import { callRoute, contractContext, expectContract } from '@/test/mobile-contract'
import { fakeSupabase, tableResolver, type FakeSupabase, type SupabaseResult } from '@/test/supabase-fake'

type Rows<T extends keyof Database['public']['Tables']> = Partial<Database['public']['Tables'][T]['Row']>[]
type AuthAdmin = SupabaseClient<Database>['auth']['admin']
type Auth = SupabaseClient<Database>['auth']

// Signing in from the app, and the account it then reads and deletes. The services run for real on a
// fake database; Bird, Stripe, Resend and the Supabase auth server are what is replaced.
const state = vi.hoisted(() => ({
    db: null as FakeSupabase | null,
    ctx: null as WorkspaceContext | null,
    user: null as User | null,
    workspaceRefused: false,
    tables: {} as Record<string, object[]>,
    rpc: {} as Record<string, SupabaseResult>,
    removedAvatars: [] as string[],
}))

const provider = vi.hoisted(() => ({
    sendVerification: vi.fn<typeof import('@/lib/sms/bird-verify').sendVerification>(),
    checkVerification: vi.fn<typeof import('@/lib/sms/bird-verify').checkVerification>(),
    subscriptionStillCharges: vi.fn<typeof import('@rerun/cloud/account').subscriptionStillCharges>(),
    stopWorkspaceCharges: vi.fn<typeof import('@rerun/cloud/account').stopWorkspaceCharges>(),
    uninstallWorkspaceApps: vi.fn<typeof import('@rerun/cloud/account').uninstallWorkspaceApps>(),
    sendSignInCodeEmail: vi.fn<typeof import('@rerun/cloud/email').sendSignInCodeEmail>(),
    grantRerunTopup: vi.fn<typeof import('@rerun/cloud/billing.server').grantRerunTopup>(),
    getUserById: vi.fn<AuthAdmin['getUserById']>(),
    createUser: vi.fn<AuthAdmin['createUser']>(),
    generateLink: vi.fn<AuthAdmin['generateLink']>(),
    updateUserById: vi.fn<AuthAdmin['updateUserById']>(),
    verifyOtp: vi.fn<Auth['verifyOtp']>(),
}))

vi.mock('@/app/api/_auth/ownership', async importOriginal => ({
    ...(await importOriginal<typeof import('@/app/api/_auth/ownership')>()),
    requireWorkspaceContext: async () => {
        if (state.workspaceRefused) throw new AuthorizationError('notMember')
        return state.ctx
    },
}))
vi.mock('@/supabase/serviceRole', () => ({ createServiceRoleClient: () => state.db?.client }))
vi.mock('@/supabase/server', () => ({
    createClient: async () => ({ ...state.db?.client, auth: { getUser: async () => ({ data: { user: state.user } }) } }),
    createSessionlessClient: () => ({ auth: { verifyOtp: provider.verifyOtp } }),
    getRequestAccessToken: async () => 'token',
}))
vi.mock('next/headers', async importOriginal => ({ ...(await importOriginal<typeof import('next/headers')>()), headers: async () => new Headers({ 'accept-language': 'fr-FR,fr;q=0.9' }) }))
vi.mock('@/lib/sms/bird-verify', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/sms/bird-verify')>()), sendVerification: provider.sendVerification, checkVerification: provider.checkVerification }))
vi.mock('@rerun/cloud/app-review', () => ({ isAppReviewNumber: () => false, isAppReviewSignIn: () => false }))
vi.mock('@rerun/cloud/account', () => ({ subscriptionStillCharges: provider.subscriptionStillCharges, stopWorkspaceCharges: provider.stopWorkspaceCharges, uninstallWorkspaceApps: provider.uninstallWorkspaceApps }))
vi.mock('@rerun/cloud/email', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/cloud/email')>()), sendSignInCodeEmail: provider.sendSignInCodeEmail }))
vi.mock('@rerun/cloud/billing.server', async importOriginal => ({ ...(await importOriginal<typeof import('@rerun/cloud/billing.server')>()), grantRerunTopup: provider.grantRerunTopup }))

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

const PHONE = '+33612345678'
const TYPED_PHONE = { phone: '06 12 34 56 78', country: 'FR' }
const PUSH_TOKEN = 'ExponentPushToken[xk3Lw9-Qd2Rf]'

function authUser(id: string, email: string, overrides: Partial<User> = {}): User {
    return { id, email, aud: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-11-02T09:00:00.000Z', is_anonymous: false, ...overrides }
}

const ada = authUser('user-ada', 'ada@atelier-nord.fr', { user_metadata: { full_name: 'Ada Lovelace', avatar_url: 'https://cdn.rerun.build/avatars/ada.png' }, last_sign_in_at: minutesFromNow(-2) })
const authUsers: Record<string, User> = { 'user-ada': ada }

function userFound(user: User): UserResponse {
    return { data: { user }, error: null }
}

function signInLink(user: User): GenerateLinkResponse {
    return {
        data: { user, properties: { action_link: 'https://auth.rerun.build/verify?token=pkce', email_otp: '000000', hashed_token: 'f3a9c1d2e4b5', redirect_to: 'https://app.rerun.build', verification_type: 'magiclink' } },
        error: null,
    }
}

function openedSession(user: User): Awaited<ReturnType<Auth['verifyOtp']>> {
    const session: Session = { access_token: 'eyJhbGciOiJIUzI1NiJ9.access', refresh_token: 'r3fr35h-t0k3n', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user }
    return { data: { user, session }, error: null }
}

const workspaces: Rows<'workspaces'> = [{ id: 7, name: 'Atelier Nord', is_sandbox: false, stripe_customer_id: 'cus_R8hJk2LmNpQ4', stripe_subscription_id: 'sub_1QxYz8LmNpQ4', subscription_status: 'active' }]
const workspaceMembers: Rows<'workspace_members'> = [{ workspace_id: 7, user_id: 'user-ada', role: 'admin', box_scope: 'all' }]
const users: Rows<'users'> = [
    {
        id: 'user-ada',
        workspace_id: 7,
        signed_up_at: '2026-11-02T09:00:00.000Z',
        locale: null,
        email_notification_prefs: { version: 2, scope: 'mine', toast: true, sound: false, email: true, coworkers: { 'agent-ledger': { mode: 'muted' } }, tasks: {}, categories: { billing: true, product: false } },
    },
]
const verifiedPhones: Rows<'user_phones'> = [{ user_id: 'user-ada', phone: PHONE, channel: 'sms', verified_at: '2026-11-02T09:05:00.000Z', required_at: '2026-11-02T09:00:00.000Z' }]

// The id Postgres would give the workspace a first sign-in creates.
const NEW_WORKSPACE_ID = 12

describe('signing in from the mobile app and its account', () => {
    beforeEach(() => {
        state.tables = { workspaces, workspace_members: workspaceMembers, users, user_phones: [], phone_sign_in_sends: [], sign_in_codes: [], device_tokens: [] }
        state.rpc = { claim_phone_sign_in_send: { data: 'ok' }, claim_phone_sign_in_verify: { data: 'ok' }, claim_email_sign_up: { data: true }, check_email_exists: { data: false }, email_domain_is_blocked: { data: false } }
        state.removedAvatars = []
        state.workspaceRefused = false
        state.user = ada
        const db = fakeSupabase((table, calls) => {
            if (table.startsWith('rpc:')) return state.rpc[table.slice('rpc:'.length)]
            const insert = calls.find(call => call.method === 'insert')
            if (table === 'workspaces' && insert) return { data: { id: NEW_WORKSPACE_ID, ...(insert.args[0] as object) } }
            return tableResolver(state.tables)(table, calls)
        })
        Object.assign(db.client, {
            auth: { admin: { getUserById: provider.getUserById, createUser: provider.createUser, generateLink: provider.generateLink, updateUserById: provider.updateUserById } },
            storage: {
                from: () => ({
                    list: async (folder: string) => ({ data: [{ name: 'portrait.png' }].map(file => ({ ...file, folder })), error: null }),
                    remove: async (paths: string[]) => {
                        state.removedAvatars.push(...paths)
                        return { data: [], error: null }
                    },
                }),
            },
        })
        state.db = db
        state.ctx = contractContext(db)

        for (const mock of Object.values(provider)) mock.mockReset()
        provider.getUserById.mockImplementation(async id => (authUsers[id] ? userFound(authUsers[id]) : { data: { user: null }, error: null } as unknown as UserResponse))
        provider.generateLink.mockImplementation(async () => signInLink(ada))
        provider.verifyOtp.mockImplementation(async () => openedSession(ada))
        provider.sendVerification.mockImplementation(async (_to, channel) => ({ ok: true, channel }))
        provider.checkVerification.mockResolvedValue({ ok: true })
        provider.subscriptionStillCharges.mockResolvedValue(false)
        provider.sendSignInCodeEmail.mockResolvedValue({ ok: true, id: 're_7f3k2m' })
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    describe('the version gate', () => {
        it('answers the minimum build of the platform and the Supabase project to sign in with', async () => {
            vi.stubEnv('MOBILE_IOS_MIN_BUILD', '36')
            vi.stubEnv('MOBILE_ANDROID_MIN_BUILD', '5')
            vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://api.rerun.build/')
            vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_Xk2m9Qd')
            const { GET } = await import('@/app/api/v1/client/route')
            expect(await expectContract(mobileApi.getClientConfig, await callRoute(GET, mobileApi.getClientConfig))).toEqual({ minBuild: 36, server: { supabaseUrl: 'https://api.rerun.build', supabasePublishableKey: 'sb_publishable_Xk2m9Qd' } })
            expect(await expectContract(mobileApi.getClientConfig, await callRoute(GET, mobileApi.getClientConfig, { client: 'android/1.0.0 (5)' }))).toMatchObject({ minBuild: 5 })
        })

        it('leaves the server out on a hub with no Supabase configured', async () => {
            vi.stubEnv('MOBILE_IOS_MIN_BUILD', '')
            vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
            vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '')
            const { GET } = await import('@/app/api/v1/client/route')
            expect(await expectContract(mobileApi.getClientConfig, await callRoute(GET, mobileApi.getClientConfig))).toEqual({ minBuild: 0 })
        })
    })

    describe('a code sent to a phone', () => {
        it('sends it on the channel picked, counted against the app', async () => {
            const { POST } = await import('@/app/api/v1/auth/phone/code/route')
            const res = await callRoute(POST, mobileApi.sendPhoneCode, { body: { ...TYPED_PHONE, channel: 'whatsapp' }, client: 'android/1.0.0 (5)' })
            expect(await expectContract(mobileApi.sendPhoneCode, res)).toEqual({ channel: 'whatsapp' })
            expect(provider.sendVerification).toHaveBeenCalledWith(PHONE, 'whatsapp', expect.objectContaining({ metadata: { context: 'sign_in' } }))
            expect(state.db?.chainsOn('rpc:claim_phone_sign_in_send')[0][0].args[1]).toMatchObject({ p_app: 'android' })
        })

        it('refuses a number that cannot be read with 400', async () => {
            const { POST } = await import('@/app/api/v1/auth/phone/code/route')
            const res = await callRoute(POST, mobileApi.sendPhoneCode, { body: { phone: '12', country: 'FR', channel: 'sms' } })
            expect(res.status).toBe(400)
            expect(await expectContract(mobileApi.sendPhoneCode, res, 400)).toMatchObject({ reason: 'invalid_number' })
            expect(provider.sendVerification).not.toHaveBeenCalled()
        })

        it('refuses a body it cannot read with the reason every build shows in its language', async () => {
            const { POST } = await import('@/app/api/v1/auth/phone/code/route')
            const res = await callRoute(POST, mobileApi.sendPhoneCode, { body: { phone: '', country: 'France', channel: 'sms' } })
            expect(res.status).toBe(400)
            expect(signInRefusalSchema.parse(await expectContract(mobileApi.sendPhoneCode, res, 400))).toMatchObject({ reason: 'invalid_number' })
            expect(provider.sendVerification).not.toHaveBeenCalled()
        })

        it('holds a second code back with 429 and says how long to wait', async () => {
            state.tables.phone_sign_in_sends = [{ phone: PHONE, send_count: 1, send_window_started_at: minutesFromNow(-0.5), last_sent_at: minutesFromNow(-0.5), last_channel: 'sms' }] satisfies Rows<'phone_sign_in_sends'>
            const { POST } = await import('@/app/api/v1/auth/phone/code/route')
            const res = await callRoute(POST, mobileApi.sendPhoneCode, { body: { ...TYPED_PHONE, channel: 'sms' } })
            expect(res.status).toBe(429)
            const refusal = (await expectContract(mobileApi.sendPhoneCode, res, 429)) as { reason: string; retryAfterSeconds?: number }
            expect(refusal.reason).toBe('too_soon')
            expect(refusal.retryAfterSeconds).toBeGreaterThan(0)
        })

        it('answers 422 when Bird cannot reach the country', async () => {
            provider.sendVerification.mockResolvedValue({ ok: false, error: 'unsupported_country' })
            const { POST } = await import('@/app/api/v1/auth/phone/code/route')
            const res = await callRoute(POST, mobileApi.sendPhoneCode, { body: { ...TYPED_PHONE, channel: 'sms' } })
            expect(res.status).toBe(422)
            expect(await expectContract(mobileApi.sendPhoneCode, res, 422)).toMatchObject({ reason: 'unsupported_country' })
        })

        it('answers 503 once everybody\'s cap on codes is reached', async () => {
            state.rpc.claim_phone_sign_in_send = { data: 'global' }
            const { POST } = await import('@/app/api/v1/auth/phone/code/route')
            const res = await callRoute(POST, mobileApi.sendPhoneCode, { body: { ...TYPED_PHONE, channel: 'sms' } })
            expect(res.status).toBe(503)
            expect(await expectContract(mobileApi.sendPhoneCode, res, 503)).toMatchObject({ reason: 'busy' })
        })
    })

    describe('a sign-in with the code', () => {
        it('opens the account the number holds and hands its session to the app', async () => {
            state.tables.user_phones = verifiedPhones
            const { POST } = await import('@/app/api/v1/auth/phone/session/route')
            const res = await callRoute(POST, mobileApi.signInWithPhone, { body: { ...TYPED_PHONE, channel: 'sms', code: '482913' } })
            expect(await expectContract(mobileApi.signInWithPhone, res)).toEqual({ created: false, session: { accessToken: 'eyJhbGciOiJIUzI1NiJ9.access', refreshToken: 'r3fr35h-t0k3n' } })
            expect(provider.checkVerification).toHaveBeenCalledWith(PHONE, '482913')
            expect(provider.createUser).not.toHaveBeenCalled()
        })

        it('creates the account of a number never seen, its phone verified', async () => {
            const newcomer = authUser('user-new', '33612345678@phone.rerun.build')
            provider.createUser.mockResolvedValue(userFound(newcomer))
            provider.generateLink.mockResolvedValue(signInLink(newcomer))
            provider.verifyOtp.mockResolvedValue(openedSession(newcomer))
            const { POST } = await import('@/app/api/v1/auth/phone/session/route')
            const res = await callRoute(POST, mobileApi.signInWithPhone, { body: { ...TYPED_PHONE, channel: 'whatsapp', code: '482913' } })
            expect(await expectContract(mobileApi.signInWithPhone, res)).toMatchObject({ created: true })
            expect(state.db?.writes('user_phones')[0].payload).toMatchObject({ user_id: 'user-new', phone: PHONE, channel: 'whatsapp' })
        })

        it('refuses a wrong code with 400', async () => {
            provider.checkVerification.mockResolvedValue({ ok: false, error: 'wrong_code' })
            const { POST } = await import('@/app/api/v1/auth/phone/session/route')
            const res = await callRoute(POST, mobileApi.signInWithPhone, { body: { ...TYPED_PHONE, channel: 'sms', code: '000111' } })
            expect(res.status).toBe(400)
            expect(await expectContract(mobileApi.signInWithPhone, res, 400)).toMatchObject({ reason: 'wrong_code' })
        })

        it('reads a code too short to be one as a wrong code, without counting a try', async () => {
            const { POST } = await import('@/app/api/v1/auth/phone/session/route')
            const res = await callRoute(POST, mobileApi.signInWithPhone, { body: { ...TYPED_PHONE, channel: 'sms', code: '12' } })
            expect(res.status).toBe(400)
            expect(signInRefusalSchema.parse(await expectContract(mobileApi.signInWithPhone, res, 400))).toMatchObject({ reason: 'wrong_code' })
            expect(state.db?.chainsOn('rpc:claim_phone_sign_in_verify') ?? []).toHaveLength(0)
            expect(provider.checkVerification).not.toHaveBeenCalled()
        })

        it('reads a number it cannot parse as an invalid number, even with a bad code', async () => {
            const { POST } = await import('@/app/api/v1/auth/phone/session/route')
            const res = await callRoute(POST, mobileApi.signInWithPhone, { body: { phone: '06 12 34 56 78', country: 'France', channel: 'sms', code: '12' } })
            expect(res.status).toBe(400)
            expect(signInRefusalSchema.parse(await expectContract(mobileApi.signInWithPhone, res, 400))).toMatchObject({ reason: 'invalid_number' })
        })

        it('stops a loop over codes with 429 before the code is looked at', async () => {
            state.rpc.claim_phone_sign_in_verify = { data: 'phone' }
            const { POST } = await import('@/app/api/v1/auth/phone/session/route')
            const res = await callRoute(POST, mobileApi.signInWithPhone, { body: { ...TYPED_PHONE, channel: 'sms', code: '482913' } })
            expect(res.status).toBe(429)
            expect(await expectContract(mobileApi.signInWithPhone, res, 429)).toEqual(expect.objectContaining({ reason: 'too_many', retryAfterSeconds: 900 }))
            expect(provider.checkVerification).not.toHaveBeenCalled()
        })

        it('answers 503 when the tries cannot be counted', async () => {
            state.rpc.claim_phone_sign_in_verify = { data: null, error: { message: 'connection reset' } }
            const { POST } = await import('@/app/api/v1/auth/phone/session/route')
            const res = await callRoute(POST, mobileApi.signInWithPhone, { body: { ...TYPED_PHONE, channel: 'sms', code: '482913' } })
            expect(res.status).toBe(503)
            expect(await expectContract(mobileApi.signInWithPhone, res, 503)).toMatchObject({ reason: 'unavailable' })
        })
    })

    describe('a code mailed to an address', () => {
        it('refuses an address it cannot read with the reason every build shows in its language', async () => {
            const { POST } = await import('@/app/api/v1/auth/email/code/route')
            const res = await callRoute(POST, mobileApi.sendEmailCode, { body: { email: 'grace at atelier-nord' } })
            expect(res.status).toBe(400)
            expect(signInRefusalSchema.parse(await expectContract(mobileApi.sendEmailCode, res, 400))).toMatchObject({ reason: 'invalid_email' })
            expect(provider.createUser).not.toHaveBeenCalled()
        })

        it('opens the account of a new address and lets the app ask Supabase for the code', async () => {
            provider.createUser.mockResolvedValue(userFound(authUser('user-new', 'grace@atelier-nord.fr')))
            const { POST } = await import('@/app/api/v1/auth/email/code/route')
            expect(await expectContract(mobileApi.sendEmailCode, await callRoute(POST, mobileApi.sendEmailCode, { body: { email: 'grace@atelier-nord.fr' } }))).toEqual({ mailed: false })
            expect(provider.createUser).toHaveBeenCalledWith({ email: 'grace@atelier-nord.fr' })
        })

        it('mails again a code still good, rather than void it with a new one', async () => {
            state.rpc.check_email_exists = { data: true }
            state.tables.sign_in_codes = [
                { email: 'ada@atelier-nord.fr', user_id: 'user-ada', type: 'magiclink', code: '482913', token_hash: 'f3a9c1d2e4b5', issued_at: minutesFromNow(-3), expires_at: minutesFromNow(12), last_sent_at: minutesFromNow(-3), send_count: 1 },
            ] satisfies Rows<'sign_in_codes'>
            authUsers['user-ada'] = { ...ada, last_sign_in_at: minutesFromNow(-2 * 24 * 60) }
            const { POST } = await import('@/app/api/v1/auth/email/code/route')
            expect(await expectContract(mobileApi.sendEmailCode, await callRoute(POST, mobileApi.sendEmailCode, { body: { email: 'ada@atelier-nord.fr' } }))).toEqual({ mailed: true })
            expect(provider.sendSignInCodeEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@atelier-nord.fr', code: '482913' }))
            authUsers['user-ada'] = ada
        })

        it('adds the created iOS 18 to 21 require to read the answer, always false', async () => {
            provider.createUser.mockResolvedValue(userFound(authUser('user-new', 'grace@atelier-nord.fr')))
            const { POST } = await import('@/app/api/v1/auth/email/code/route')
            const res = await callRoute(POST, mobileApi.sendEmailCode, { body: { email: 'grace@atelier-nord.fr' }, client: 'ios/1.0.0 (18)' })
            expect(await res.clone().json()).toEqual({ mailed: false, created: false })
            await expectContract(mobileApi.sendEmailCode, res)
        })

        it('answers 429 to a network asking too often', async () => {
            state.rpc.claim_email_sign_up = { data: false }
            const { POST } = await import('@/app/api/v1/auth/email/code/route')
            const res = await callRoute(POST, mobileApi.sendEmailCode, { body: { email: 'grace@atelier-nord.fr' } })
            expect(res.status).toBe(429)
            expect(await expectContract(mobileApi.sendEmailCode, res, 429)).toMatchObject({ reason: 'too_many' })
        })

        it('answers 422 to a domain accounts may not open on', async () => {
            state.rpc.email_domain_is_blocked = { data: true }
            const { POST } = await import('@/app/api/v1/auth/email/code/route')
            const res = await callRoute(POST, mobileApi.sendEmailCode, { body: { email: 'someone@mailinator.com' } })
            expect(res.status).toBe(422)
            expect(await expectContract(mobileApi.sendEmailCode, res, 422)).toMatchObject({ reason: 'blocked_domain' })
            expect(provider.createUser).not.toHaveBeenCalled()
        })

        it('answers 503 when the address cannot be looked up', async () => {
            state.rpc.check_email_exists = { data: null, error: { message: 'connection reset' } }
            const { POST } = await import('@/app/api/v1/auth/email/code/route')
            const res = await callRoute(POST, mobileApi.sendEmailCode, { body: { email: 'grace@atelier-nord.fr' } })
            expect(res.status).toBe(503)
            expect(await expectContract(mobileApi.sendEmailCode, res, 503)).toMatchObject({ reason: 'unavailable' })
        })

        // The registry reads every 400 of a sign-in route as a refusal with its `reason`: a body the
        // schema refuses is answered by apiRoute itself, with none.
        it('answers a body it cannot read with a refusal the app can read', async () => {
            const { POST } = await import('@/app/api/v1/auth/email/code/route')
            const res = await callRoute(POST, mobileApi.sendEmailCode, { body: { email: 'ada at atelier-nord' } })
            expect(res.status).toBe(400)
            await expectContract(mobileApi.sendEmailCode, res, 400)
        })
    })

    describe('the first call after a sign-in', () => {
        it('reads the account and its workspace', async () => {
            const { POST } = await import('@/app/api/v1/bootstrap/route')
            const me = (await expectContract(mobileApi.bootstrap, await callRoute(POST, mobileApi.bootstrap))) as { user: { email: string }; workspace: { id: number; role: string } }
            expect(me.user.email).toBe('ada@atelier-nord.fr')
            expect(me.workspace).toMatchObject({ id: 7, role: 'admin' })
            expect(state.db?.writes('workspaces')).toEqual([])
        })

        it('provisions the workspace of an account born on this sign-in', async () => {
            state.tables.users = []
            const { POST } = await import('@/app/api/v1/bootstrap/route')
            await expectContract(mobileApi.bootstrap, await callRoute(POST, mobileApi.bootstrap))
            expect(state.db?.writes('users')[0].payload).toMatchObject({ id: 'user-ada', workspace_id: NEW_WORKSPACE_ID })
            expect(state.db?.writes('workspace_members')[0].payload).toEqual({ user_id: 'user-ada', workspace_id: NEW_WORKSPACE_ID, role: 'admin' })
            expect(provider.grantRerunTopup).toHaveBeenCalledWith(NEW_WORKSPACE_ID, expect.any(Number))
        })

        it('answers 403 for a workspace the device kept and the account left', async () => {
            state.workspaceRefused = true
            const { POST } = await import('@/app/api/v1/bootstrap/route')
            const res = await callRoute(POST, mobileApi.bootstrap)
            expect(res.status).toBe(403)
            await expectContract(mobileApi.bootstrap, res, 403)
        })
    })

    describe('deleting the account', () => {
        it('names the workspace whose subscription still bills', async () => {
            provider.subscriptionStillCharges.mockResolvedValue(true)
            const { GET } = await import('@/app/api/v1/me/account/route')
            expect(await expectContract(mobileApi.getAccountDeletion, await callRoute(GET, mobileApi.getAccountDeletion))).toEqual({ blockers: [{ workspaceId: 7, name: 'Atelier Nord' }] })
            expect(provider.subscriptionStillCharges).toHaveBeenCalledWith('sub_1QxYz8LmNpQ4')
        })

        it('finds nothing in the way once the subscription stopped billing', async () => {
            const { GET } = await import('@/app/api/v1/me/account/route')
            expect(await expectContract(mobileApi.getAccountDeletion, await callRoute(GET, mobileApi.getAccountDeletion))).toEqual({ blockers: [] })
        })

        it('anonymizes the account and switches its own workspace off', async () => {
            const { DELETE } = await import('@/app/api/v1/me/account/route')
            await expectContract(mobileApi.deleteAccount, await callRoute(DELETE, mobileApi.deleteAccount, { body: { confirmation: 'DELETE' } }))
            expect(provider.stopWorkspaceCharges).toHaveBeenCalledWith(state.db?.client, expect.objectContaining({ id: 7 }))
            expect(state.db?.writes('agents')[0].payload).toMatchObject({ disabled_reason: 'account_deleted' })
            expect(state.removedAvatars).toEqual(['user-ada/portrait.png'])
            expect(state.db?.chainsOn('rpc:anonymize_auth_user')).toHaveLength(1)
        })

        it('asks for a fresh sign-in with 403', async () => {
            state.user = { ...ada, last_sign_in_at: minutesFromNow(-11) }
            const { DELETE } = await import('@/app/api/v1/me/account/route')
            const res = await callRoute(DELETE, mobileApi.deleteAccount, { body: { confirmation: 'DELETE' } })
            expect(res.status).toBe(403)
            expect(await expectContract(mobileApi.deleteAccount, res, 403)).toMatchObject({ reason: 'reauth_required' })
            expect(state.db?.chainsOn('rpc:anonymize_auth_user')).toHaveLength(0)
        })

        it('refuses with 409 while a subscription still bills, and names it', async () => {
            provider.subscriptionStillCharges.mockResolvedValue(true)
            const { DELETE } = await import('@/app/api/v1/me/account/route')
            const res = await callRoute(DELETE, mobileApi.deleteAccount, { body: { confirmation: 'DELETE' } })
            expect(res.status).toBe(409)
            expect(await expectContract(mobileApi.deleteAccount, res, 409)).toMatchObject({ blockers: [{ workspaceId: 7, name: 'Atelier Nord' }] })
            expect(state.db?.writes('agents')).toEqual([])
        })
    })

    describe('the notification settings', () => {
        it('reads the saved settings', async () => {
            const { GET } = await import('@/app/api/v1/me/notifications/route')
            expect(await expectContract(mobileApi.getNotificationPrefs, await callRoute(GET, mobileApi.getNotificationPrefs))).toMatchObject({ scope: 'mine', sound: false, coworkers: { 'agent-ledger': { mode: 'muted' } }, categories: { billing: true, product: false } })
        })

        it('merges a change into them and answers the whole settings', async () => {
            const { PATCH } = await import('@/app/api/v1/me/notifications/route')
            const res = await callRoute(PATCH, mobileApi.updateNotificationPrefs, { body: { scope: 'needed', coworkers: { 'agent-scout': { mode: 'everything' } } } })
            const prefs = await expectContract(mobileApi.updateNotificationPrefs, res)
            expect(prefs).toMatchObject({ scope: 'needed', sound: false, coworkers: { 'agent-ledger': { mode: 'muted' }, 'agent-scout': { mode: 'everything' } } })
            expect(state.db?.writes('users')[0].payload).toEqual({ email_notification_prefs: prefs })
        })
    })

    describe('the push token of the phone', () => {
        it('registers it on launch', async () => {
            const { POST } = await import('@/app/api/v1/me/devices/route')
            await expectContract(mobileApi.registerDevice, await callRoute(POST, mobileApi.registerDevice, { body: { token: PUSH_TOKEN, platform: 'ios', appVersion: '1.0.2 (38)' } }))
            expect(state.db?.writes('device_tokens')[0]).toMatchObject({ method: 'upsert', payload: { user_id: 'user-ada', token: PUSH_TOKEN, platform: 'ios', app_version: '1.0.2 (38)', revoked_at: null } })
        })

        it('leaves a token another account still uses to that account', async () => {
            state.tables.device_tokens = [{ token: PUSH_TOKEN, user_id: 'user-grace', revoked_at: null, last_seen_at: minutesFromNow(-60) }] satisfies Rows<'device_tokens'>
            const { POST } = await import('@/app/api/v1/me/devices/route')
            const res = await callRoute(POST, mobileApi.registerDevice, { body: { token: PUSH_TOKEN, platform: 'ios' } })
            expect(res.status).toBe(409)
            await expectContract(mobileApi.registerDevice, res, 409)
            expect(state.db?.writes('device_tokens')).toEqual([])
        })

        it('revokes the caller\'s own token on sign-out', async () => {
            const { DELETE } = await import('@/app/api/v1/me/devices/route')
            await expectContract(mobileApi.unregisterDevice, await callRoute(DELETE, mobileApi.unregisterDevice, { body: { token: PUSH_TOKEN, platform: 'ios' } }))
            const [write] = state.db?.writes('device_tokens') ?? []
            expect(write.method).toBe('update')
            expect(write.filters.map(filter => filter.args)).toEqual([
                ['token', PUSH_TOKEN],
                ['user_id', 'user-ada'],
            ])
        })
    })
})
