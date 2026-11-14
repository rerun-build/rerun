import { inNamespace } from './linkup/namespace'

export const CONNECTING_GRACE_MS = 60 * 60_000

export const UNPAID_PAUSE_GRACE_MS = 7 * 86_400_000

export type LinkupAccountRef = { account_id: string; platform: string; account_name: string | null; created_at: string }

export type ConnectionRef = { id: string; provider_account_id: string | null; status: string; pause_reason: string | null; updated_at: string }

export type AccountVerdict = { accountId: string; connectionId: string | null; reason: 'orphan' | 'not_connected' | 'unpaid_pause' | 'stale_connect' }

export function accountsToDelete(accounts: LinkupAccountRef[], connections: ConnectionRef[], now: Date, namespace: string, platforms: readonly string[]): AccountVerdict[] {
    const live = new Map<string, ConnectionRef>()
    for (const connection of connections) {
        if (connection.provider_account_id && connection.status !== 'deleted') live.set(connection.provider_account_id, connection)
    }

    const verdicts: AccountVerdict[] = []
    for (const account of accounts) {
        if (!platforms.includes(account.platform) || !inNamespace(account.account_name, namespace)) continue
        const connection = live.get(account.account_id)
        const age = now.getTime() - new Date(account.created_at).getTime()
        if (!connection) {
            if (age > CONNECTING_GRACE_MS) verdicts.push({ accountId: account.account_id, connectionId: null, reason: 'orphan' })
            continue
        }
        const idle = now.getTime() - new Date(connection.updated_at).getTime()
        if (connection.status === 'connected') continue
        if (connection.status === 'connecting') {
            if (idle > CONNECTING_GRACE_MS) verdicts.push({ accountId: account.account_id, connectionId: connection.id, reason: 'stale_connect' })
            continue
        }
        if (connection.status === 'paused') {
            if (connection.pause_reason === 'rate_limited') continue
            if (idle > UNPAID_PAUSE_GRACE_MS) verdicts.push({ accountId: account.account_id, connectionId: connection.id, reason: 'unpaid_pause' })
            continue
        }
        verdicts.push({ accountId: account.account_id, connectionId: connection.id, reason: 'not_connected' })
    }
    return verdicts
}
