import { AppError } from '@/lib/i18n/action-error'
import { fetchPublic } from '@/lib/net/public-fetch'

const MYSHOPIFY_HOST = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/

function storeHost(domain: string): string {
    return domain
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '')
        .replace(/[/?#].*$/, '')
}

// The engine only exchanges the Client ID and secret for a token at the coworker's first Shopify call, so
// an app not installed on the store would be saved as connected. Asked here once, the token is dropped.
// Any answer of Shopify about these credentials refuses them: a network failure, a rate limit or an outage
// says nothing. The values come back cleaned, since the MCP server uses the domain exactly as it is saved.
export async function checkShopifyCredentials(slug: string, methodId: string, values: Record<string, string>): Promise<Record<string, string>> {
    if (slug !== 'shopify' || methodId !== 'client_credentials') return values

    const host = storeHost(values.MYSHOPIFY_DOMAIN ?? '')
    if (!MYSHOPIFY_HOST.test(host)) throw new AppError('shopifyStoreNotFound', { domain: values.MYSHOPIFY_DOMAIN?.trim() ?? '' })
    const checked = { ...values, MYSHOPIFY_DOMAIN: host, SHOPIFY_CLIENT_ID: values.SHOPIFY_CLIENT_ID?.trim() ?? '', SHOPIFY_CLIENT_SECRET: values.SHOPIFY_CLIENT_SECRET?.trim() ?? '' }

    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: checked.SHOPIFY_CLIENT_ID, client_secret: checked.SHOPIFY_CLIENT_SECRET })
    const res = await fetchPublic(`https://${host}/admin/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body }).catch(() => null)
    if (!res || res.ok) return checked

    const answer = await res.text().catch(() => '')
    if (answer.includes('app_not_installed')) throw new AppError('shopifyAppNotInstalled', { domain: host })
    if (answer.includes('shop_not_permitted')) throw new AppError('shopifyShopNotPermitted', { domain: host })
    if (res.status === 404) throw new AppError('shopifyStoreNotFound', { domain: host })
    if (res.status === 401 || answer.includes('application_cannot_be_found')) throw new AppError('shopifyCredentialsRejected')
    if (res.status === 400 || res.status === 403) throw new AppError('shopifyCredentialsRefused', { domain: host })
    return checked
}
