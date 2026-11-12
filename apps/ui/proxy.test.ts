import { BRAND_GATE_COOKIE } from '@rerun/contracts'
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server'
import { NextRequest, NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateSession: vi.fn() }))

vi.mock('@/supabase/middleware', () => ({ updateSession: mocks.updateSession }))

const { config, proxy } = await import('./proxy')

const TOKEN = 'kit-token'

function matches(url: string): boolean {
    return unstable_doesMiddlewareMatch({ config, url })
}

beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateSession.mockResolvedValue(NextResponse.next())
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BRAND_GATE_TOKEN', TOKEN)
})

afterEach(() => vi.unstubAllEnvs())

describe('proxy brand gate', () => {
    it('answers 404 on a lab without the token, and never reads a session', async () => {
        const response = await proxy(new NextRequest('https://app.rerun.build/render/lab'))

        expect(response.status).toBe(404)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(mocks.updateSession).not.toHaveBeenCalled()
    })

    it('answers 404 under a lab with a wrong key', async () => {
        const response = await proxy(new NextRequest('https://app.rerun.build/render/lab/buttons?key=wrong'))

        expect(response.status).toBe(404)
    })

    it('opens with the key and remembers it on the parent domain', async () => {
        const response = await proxy(new NextRequest(`https://app.rerun.build/render/lab?key=${TOKEN}`, { headers: { host: 'app.rerun.build' } }))

        expect(response.status).toBe(200)
        const cookie = response.cookies.get(BRAND_GATE_COOKIE)
        expect(cookie?.value).toBe(TOKEN)
        expect(cookie?.domain).toBe('.rerun.build')
        expect(cookie?.secure).toBe(true)
    })

    it('opens with the cookie without setting it again', async () => {
        const response = await proxy(new NextRequest('https://app.rerun.build/render/lab', { headers: { cookie: `${BRAND_GATE_COOKIE}=${TOKEN}` } }))

        expect(response.status).toBe(200)
        expect(response.cookies.get(BRAND_GATE_COOKIE)).toBeUndefined()
    })

    it('stays closed on a deployed host with no token configured', async () => {
        vi.stubEnv('BRAND_GATE_TOKEN', '')

        const response = await proxy(new NextRequest('https://app.rerun.build/render/lab?key='))

        expect(response.status).toBe(404)
    })

    it('stays open in development', async () => {
        vi.stubEnv('NODE_ENV', 'development')

        const response = await proxy(new NextRequest('http://localhost:3000/render/lab'))

        expect(response.status).toBe(200)
    })

    it('hands every other path to the session refresh', async () => {
        await proxy(new NextRequest('https://app.rerun.build/render/labels'))
        await proxy(new NextRequest('https://app.rerun.build/board'))

        expect(mocks.updateSession).toHaveBeenCalledTimes(2)
    })
})

describe('proxy staging gate', () => {
    const PASSWORD = 'staging-password'
    const credentials = `Basic ${btoa(`me:${PASSWORD}`)}`

    beforeEach(() => vi.stubEnv('STAGING_PASSWORD', PASSWORD))

    it('asks for the password on a page, and never reads a session', async () => {
        const response = await proxy(new NextRequest('https://staging.rerun.build/board'))

        expect(response.status).toBe(401)
        expect(response.headers.get('www-authenticate')).toContain('Basic')
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(mocks.updateSession).not.toHaveBeenCalled()
    })

    it('hands the page to the session refresh with the right password', async () => {
        const response = await proxy(new NextRequest('https://staging.rerun.build/board', { headers: { authorization: credentials } }))

        expect(response.status).toBe(200)
        expect(mocks.updateSession).toHaveBeenCalledTimes(1)
    })

    it('leaves the API open to callers that have no prompt to answer', async () => {
        const response = await proxy(new NextRequest('https://staging.rerun.build/api/stripe/webhook', { method: 'POST' }))

        expect(response.status).toBe(200)
        expect(mocks.updateSession).toHaveBeenCalledTimes(1)
    })

    it('does not exist where no password is configured', async () => {
        vi.stubEnv('STAGING_PASSWORD', '')

        const response = await proxy(new NextRequest('https://app.rerun.build/board'))

        expect(response.status).toBe(200)
    })
})

describe('proxy matcher', () => {
    it('runs on app pages', () => {
        expect(matches('/')).toBe(true)
        expect(matches('/board')).toBe(true)
        expect(matches('/api/chat')).toBe(true)
    })

    it('stays off the public webhook triggers and the mobile API, which would otherwise provision a user per hit', () => {
        expect(matches('/api/t/abc123')).toBe(false)
        expect(matches('/api/v1/agents')).toBe(false)
    })

    it('stays off the desktop app configuration, asked before any session exists', () => {
        expect(matches('/api/desktop/config')).toBe(false)
        expect(matches('/api/desktop/auth/exchange')).toBe(true)
    })

    it('stays off uploads, the model proxy, captures and static assets', () => {
        expect(matches('/api/files/upload')).toBe(false)
        expect(matches('/api/llm/v1/messages')).toBe(false)
        expect(matches('/render/brand/og')).toBe(false)
        expect(matches('/render/kit')).toBe(false)
        expect(matches('/render/kit/buttons')).toBe(false)
        expect(matches('/render/templates/crm')).toBe(false)
        expect(matches('/og/agent')).toBe(false)
        expect(matches('/logo.png')).toBe(false)
    })

    it('puts the labs back in for the gate alone', () => {
        expect(matches('/render/lab')).toBe(true)
        expect(matches('/render/lab/motion/cards')).toBe(true)
    })
})
