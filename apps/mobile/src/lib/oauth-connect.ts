import * as WebBrowser from 'expo-web-browser'

import { claimMcpSignIn, connectMcpServer } from '@/api/mcp'
import { claimServiceSignIn, connectService, readService } from '@/api/services'
import { translatorFor } from '@/i18n/translator'

type Caller = { accessToken: string; workspaceId: number }

export type ConnectOutcome = { status: 'connected' } | { status: 'cancelled' } | { status: 'error'; message: string }

// Read when the sign-in ends, in the language the app shows then.
const oauthText = (key: 'unfinished' | 'authorizationFailed' | 'startFailed') => translatorFor('mobileProviders')(`oauth.${key}`)

// iOS refuses a second auth session while one is open, and a double tap would otherwise answer the
// coworker twice. The promise is also the only channel the result travels through: no Linking
// listener hears the callback, so it cannot be delivered twice.
let inFlight: Promise<ConnectOutcome> | null = null

function exclusive(start: () => Promise<ConnectOutcome>): Promise<ConnectOutcome> {
    inFlight ??= start().finally(() => {
        inFlight = null
    })
    return inFlight
}

// The browser that ran the sign-in had no session: the callback parked what the provider handed over
// under a claim, and only this call, with the person's own token, puts it on the Box.
async function signInClaim(target: { url: string; returnUrl: string }): Promise<{ status: 'cancelled' } | { status: 'error'; message: string } | { status: 'claim'; claim: string }> {
    // Not ephemeral on purpose: the person keeps the provider session Safari already holds.
    const result = await WebBrowser.openAuthSessionAsync(target.url, target.returnUrl)
    if (result.type !== 'success') return { status: 'cancelled' }
    const returned = new URL(result.url)
    if (returned.searchParams.get('status') !== 'success') return { status: 'error', message: returned.searchParams.get('message') ?? oauthText('authorizationFailed') }
    const claim = returned.searchParams.get('claim')
    return claim ? { status: 'claim', claim } : { status: 'error', message: oauthText('unfinished') }
}

export function runConnect(caller: Caller, agentId: string, slug: string): Promise<ConnectOutcome> {
    return exclusive(() => connect(caller, agentId, slug))
}

// A server the coworker registered itself: the claim writes the token onto the Box, which is the
// whole answer.
export function runMcpConnect(caller: Caller, agentId: string, name: string): Promise<ConnectOutcome> {
    return exclusive(async () => {
        try {
            const ended = await signInClaim(await connectMcpServer(caller, agentId, name))
            if (ended.status !== 'claim') return ended
            await claimMcpSignIn(caller, agentId, name, ended.claim)
            return { status: 'connected' }
        } catch (err) {
            return { status: 'error', message: err instanceof Error ? err.message : oauthText('startFailed') }
        }
    })
}

async function connect(caller: Caller, agentId: string, slug: string): Promise<ConnectOutcome> {
    try {
        const ended = await signInClaim(await connectService(caller, agentId, slug))
        if (ended.status !== 'claim') return ended
        await claimServiceSignIn(caller, agentId, slug, ended.claim)
        // The registry says whether the app is connected, not the redirect.
        const service = await readService(caller, agentId, slug)
        return service.installStatus === 'active' ? { status: 'connected' } : { status: 'error', message: oauthText('unfinished') }
    } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : oauthText('startFailed') }
    }
}
