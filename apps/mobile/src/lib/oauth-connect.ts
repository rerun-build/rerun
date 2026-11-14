import * as WebBrowser from 'expo-web-browser'

import { claimMcpSignIn, connectMcpServer } from '@/api/mcp'
import { claimServiceSignIn, connectService, readService } from '@/api/services'
import { translatorFor } from '@/i18n/translator'

type Caller = { accessToken: string; workspaceId: number }

export type ConnectOutcome = { status: 'connected' } | { status: 'cancelled' } | { status: 'error'; message: string }

const oauthText = (key: 'unfinished' | 'authorizationFailed' | 'startFailed') => translatorFor('mobileProviders')(`oauth.${key}`)

let inFlight: Promise<ConnectOutcome> | null = null

function exclusive(start: () => Promise<ConnectOutcome>): Promise<ConnectOutcome> {
    inFlight ??= start().finally(() => {
        inFlight = null
    })
    return inFlight
}

async function signInClaim(target: { url: string; returnUrl: string }): Promise<{ status: 'cancelled' } | { status: 'error'; message: string } | { status: 'claim'; claim: string }> {
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
        const service = await readService(caller, agentId, slug)
        return service.installStatus === 'active' ? { status: 'connected' } : { status: 'error', message: oauthText('unfinished') }
    } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : oauthText('startFailed') }
    }
}
