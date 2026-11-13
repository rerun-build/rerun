import type { CoworkerVault, VaultEntryView } from '@/app/api/_services/vault.service'

export type VaultGroup = 'apps' | 'mcp' | 'secrets'

export function vaultGroupOf(entry: Pick<VaultEntryView, 'kind'>): VaultGroup {
    if (entry.kind === 'mcp') return 'mcp'
    if (entry.kind === 'secret') return 'secrets'
    return 'apps'
}

const SHOWN_NAMES = 2

export type UsedByText = {
    everyone: string
    unused: string
    usedBy: (names: string) => string
    usedByMore: (names: string, count: number) => string
    hidden: (count: number) => string
}

// Who uses an entry, in as few words as the row has room for: everyone, nobody, or the first names.
export function usedBySummary(entry: Pick<VaultEntryView, 'sharedWithAll' | 'coworkers' | 'hiddenCoworkers'>, text: UsedByText): string {
    if (entry.sharedWithAll) return text.everyone
    const total = entry.coworkers.length + entry.hiddenCoworkers
    if (total === 0) return text.unused
    const names = entry.coworkers.slice(0, SHOWN_NAMES).map(c => c.name)
    const more = total - names.length
    if (names.length === 0) return text.hidden(more)
    return more > 0 ? text.usedByMore(names.join(', '), more) : text.usedBy(names.join(', '))
}

export function matchesVaultQuery(entry: Pick<VaultEntryView, 'name' | 'label' | 'slug' | 'envKeys' | 'coworkers'>, query: string): boolean {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return [entry.name, entry.label ?? '', entry.slug ?? '', ...entry.envKeys, ...entry.coworkers.map(c => c.name)].some(text => text.toLowerCase().includes(q))
}

export type VaultAccount = { id: string; label: string }

// What the user can hand a coworker from the Vault instead of signing in to the app again.
export function vaultAccountsFor(vault: Pick<CoworkerVault, 'available'> | null, slug: string): VaultAccount[] {
    return (vault?.available ?? []).filter(item => item.kind === 'service' && item.slug === slug && item.status === 'active').map(item => ({ id: item.id, label: item.label ?? item.name }))
}
