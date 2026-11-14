import { resolvesToPublicAddresses } from '@/lib/net/public-fetch'

const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

async function assertPublicHost(hostname: string) {
    if (!(await resolvesToPublicAddresses(hostname))) throw new Error(`${hostname} resolves to a private address`)
}

export async function fetchPublic(url: string, { accept, timeoutMs }: { accept: string; timeoutMs: number }): Promise<Response> {
    await assertPublicHost(new URL(url).hostname)
    const res = await fetch(url, { headers: { 'user-agent': BROWSER_USER_AGENT, accept }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    await assertPublicHost(new URL(res.url || url).hostname)
    return res
}
