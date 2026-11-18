import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveAuthConfigId } from './client'

beforeEach(() => {
    vi.stubEnv('COMPOSIO_API_KEY', 'test-key')
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
})

const list = (items: unknown[]) => Response.json({ items, next_cursor: null, total_pages: 1, current_page: 1, total_items: items.length })

describe('resolveAuthConfigId', () => {
    it('uses the id set on the service without asking Composio', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        await expect(resolveAuthConfigId({ toolkit: 'gmail', authConfigId: 'ac_set' })).resolves.toBe('ac_set')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reuses an enabled auth config of the toolkit instead of creating one', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            list([
                { id: 'ac_off', status: 'DISABLED', toolkit: { slug: 'notion' } },
                { id: 'ac_on', status: 'ENABLED', toolkit: { slug: 'notion' } },
            ])
        )
        vi.stubGlobal('fetch', fetchMock)

        await expect(resolveAuthConfigId({ toolkit: 'notion', authConfigId: '' })).resolves.toBe('ac_on')
        expect(fetchMock).toHaveBeenCalledOnce()
        const [url, init] = fetchMock.mock.calls[0]
        expect(url).toBe('https://backend.composio.dev/api/v3.1/auth_configs?toolkit_slug=notion&limit=200')
        expect(init.headers).toMatchObject({ 'x-api-key': 'test-key' })
    })

    it('creates one on Composio-managed auth when the toolkit has none, and asks only once', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(list([{ id: 'ac_off', status: 'DISABLED', toolkit: { slug: 'slack' } }]))
            .mockResolvedValueOnce(Response.json({ toolkit: { slug: 'slack' }, auth_config: { id: 'ac_new', auth_scheme: 'OAUTH2', is_composio_managed: true } }, { status: 201 }))
        vi.stubGlobal('fetch', fetchMock)

        await expect(resolveAuthConfigId({ toolkit: 'slack', authConfigId: '' })).resolves.toBe('ac_new')
        const [url, init] = fetchMock.mock.calls[1]
        expect(url).toBe('https://backend.composio.dev/api/v3.1/auth_configs')
        expect(init.method).toBe('POST')
        expect(JSON.parse(init.body)).toEqual({ toolkit: { slug: 'slack' }, auth_config: { type: 'use_composio_managed_auth', name: 'Moldwright slack' } })

        await expect(resolveAuthConfigId({ toolkit: 'slack', authConfigId: '' })).resolves.toBe('ac_new')
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('shares one lookup between two connects started at once', async () => {
        const fetchMock = vi.fn().mockResolvedValue(list([{ id: 'ac_one', status: 'ENABLED', toolkit: { slug: 'github' } }]))
        vi.stubGlobal('fetch', fetchMock)

        const both = await Promise.all([resolveAuthConfigId({ toolkit: 'github', authConfigId: '' }), resolveAuthConfigId({ toolkit: 'github', authConfigId: '' })])

        expect(both).toEqual(['ac_one', 'ac_one'])
        expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('says the app needs its own OAuth app when Composio refuses managed auth, and tries again next time', async () => {
        const refusal = { error: { message: 'Composio managed auth is not available for this toolkit', code: 400, slug: 'Auth_Config_ValidationError', status: 400 } }
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(list([]))
            .mockResolvedValueOnce(Response.json(refusal, { status: 400 }))
            .mockResolvedValueOnce(list([{ id: 'ac_custom', status: 'ENABLED', toolkit: { slug: 'salesforce' } }]))
        vi.stubGlobal('fetch', fetchMock)

        const err = await resolveAuthConfigId({ toolkit: 'salesforce', authConfigId: '' }).catch((e: unknown) => e)
        expect(err).toMatchObject({ status: 400 })
        expect((err as Error).message).toContain('salesforce has no Composio-managed sign-in, so it needs its own OAuth app or credentials')
        expect((err as Error).message).toContain('Composio managed auth is not available for this toolkit')

        await expect(resolveAuthConfigId({ toolkit: 'salesforce', authConfigId: '' })).resolves.toBe('ac_custom')
    })

    it('passes a bad key through rather than blaming the toolkit', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn()
                .mockResolvedValueOnce(list([]))
                .mockResolvedValueOnce(new Response('invalid api key', { status: 401 }))
        )

        const err = await resolveAuthConfigId({ toolkit: 'figma', authConfigId: '' }).catch((e: unknown) => e)
        expect(err).toMatchObject({ status: 401 })
        expect((err as Error).message).not.toContain('own OAuth app')
    })
})
