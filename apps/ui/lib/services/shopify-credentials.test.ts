import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchPublic } from '@/lib/net/public-fetch'
import { checkShopifyCredentials } from './shopify-credentials'

vi.mock('@/lib/net/public-fetch', () => ({ fetchPublic: vi.fn() }))

const VALUES = { SHOPIFY_CLIENT_ID: 'client-id', SHOPIFY_CLIENT_SECRET: 'shpss_secret', MYSHOPIFY_DOMAIN: 'my-store.myshopify.com' }

function check(values: Record<string, string>) {
    return checkShopifyCredentials('shopify', 'client_credentials', values)
}

function shopifyAnswers(status: number, body: string) {
    vi.mocked(fetchPublic).mockResolvedValue(new Response(body, { status }))
}

beforeEach(() => vi.clearAllMocks())

describe('checkShopifyCredentials', () => {
    it('asks the store for a token with the Client ID and secret, and gives back the cleaned values', async () => {
        shopifyAnswers(200, JSON.stringify({ access_token: 'shpat_x', scope: 'read_products' }))

        await expect(check({ SHOPIFY_CLIENT_ID: ' client-id ', SHOPIFY_CLIENT_SECRET: 'shpss_secret\n', MYSHOPIFY_DOMAIN: ' https://My-Store.myshopify.com/admin ' })).resolves.toEqual(VALUES)

        const [url, init] = vi.mocked(fetchPublic).mock.calls[0]
        expect(url).toBe('https://my-store.myshopify.com/admin/oauth/access_token')
        expect(init?.method).toBe('POST')
        expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({ grant_type: 'client_credentials', client_id: 'client-id', client_secret: 'shpss_secret' })
    })

    it.each([
        ['another app', 'stripe', 'api-key'],
        ['the access token method', 'shopify', 'default'],
    ])('leaves %s alone', async (_, slug, methodId) => {
        const values = { MYSHOPIFY_DOMAIN: ' https://My-Store.myshopify.com/ ', SHOPIFY_ACCESS_TOKEN: 'shpat_x' }

        await expect(checkShopifyCredentials(slug, methodId, values)).resolves.toBe(values)
        expect(fetchPublic).not.toHaveBeenCalled()
    })

    it('refuses an app not installed on the store', async () => {
        shopifyAnswers(400, '<title>400 - Oauth error app_not_installed</title> The application is not installed on this shop.')

        await expect(check(VALUES)).rejects.toMatchObject({ code: 'shopifyAppNotInstalled', params: { domain: 'my-store.myshopify.com' } })
    })

    it('refuses a store outside the organization of the app', async () => {
        shopifyAnswers(400, 'Oauth error shop_not_permitted: Client credentials cannot be performed on this shop.')

        await expect(check(VALUES)).rejects.toMatchObject({ code: 'shopifyShopNotPermitted', params: { domain: 'my-store.myshopify.com' } })
    })

    it.each([
        ['an unknown Client ID', 400, JSON.stringify({ error: 'application_cannot_be_found', error_description: 'Could not find Shopify API application with api_key client-id' })],
        ['a 401', 401, 'Unauthorized'],
    ])('refuses %s', async (_, status, body) => {
        shopifyAnswers(status, body)

        await expect(check(VALUES)).rejects.toMatchObject({ code: 'shopifyCredentialsRejected' })
    })

    it.each([
        ['a 400 it does not name', 400, JSON.stringify({ error: 'invalid_client' })],
        ['a 403', 403, '<html>Your connection needs to be verified before you can proceed</html>'],
    ])('refuses %s', async (_, status, body) => {
        shopifyAnswers(status, body)

        await expect(check(VALUES)).rejects.toMatchObject({ code: 'shopifyCredentialsRefused', params: { domain: 'my-store.myshopify.com' } })
    })

    it('refuses a store Shopify does not know', async () => {
        shopifyAnswers(404, JSON.stringify({ errors: 'Not Found' }))

        await expect(check(VALUES)).rejects.toMatchObject({ code: 'shopifyStoreNotFound', params: { domain: 'my-store.myshopify.com' } })
    })

    it.each(['walkingstick.com', 'localhost:3000', '169.254.169.254', 'my-store.myshopify.com.evil.io'])('refuses %s without calling it', async domain => {
        await expect(check({ ...VALUES, MYSHOPIFY_DOMAIN: domain })).rejects.toMatchObject({ code: 'shopifyStoreNotFound', params: { domain } })
        expect(fetchPublic).not.toHaveBeenCalled()
    })

    it.each<[string, () => void]>([
        ['an outage', () => shopifyAnswers(503, 'Service unavailable')],
        ['a rate limit', () => shopifyAnswers(429, 'Too many requests')],
        ['a timeout', () => shopifyAnswers(408, 'Request timeout')],
        ['a network failure', () => vi.mocked(fetchPublic).mockRejectedValue(new Error('fetch failed'))],
    ])('keeps the credentials on %s', async (_, answer) => {
        answer()

        await expect(check(VALUES)).resolves.toEqual(VALUES)
    })
})
