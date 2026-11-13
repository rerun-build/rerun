'use client'

import { addVaultServiceAction, markVaultEntryAuthorizedAction, reconfigureVaultServiceAction } from '@/app/api/_actions/vault.actions'
import type { VaultAddResult } from '@/app/api/_services/vault-install.service'
import type { ServiceSetupDriver } from '@/components/services/service-setup-driver'
import type { InstallResult } from '@/lib/services/types'

// The install form of a catalog app, pointed at the Vault: the first submit adds an entry (attached to
// the coworkers picked, if any), the next ones configure that same entry again. The key the form
// carries from then on is the entry's id.
export type VaultSetupState = { itemId: string | null; agentIds: string[]; onItem: (itemId: string) => void }

function asInstallResult(result: VaultAddResult, name: string): InstallResult {
    const { item } = result
    const base = { key: item.id, slug: item.slug ?? '', name }
    if (result.status === 'needs_config') return { status: 'needs_config', ...base, authMethods: result.authMethods, authMethodId: result.authMethodId, message: '' }
    if (result.status === 'needs_auth') return { status: 'needs_auth', ...base, oauth: result.oauth, message: '' }
    return { status: 'installed', ...base, toolNames: item.mcpServers.map(server => server.name), message: '' }
}

export function vaultSetupDriver(state: VaultSetupState, name: string): ServiceSetupDriver {
    return {
        install: async (_agentId, key, values, authMethodId) => {
            const res = state.itemId ? await reconfigureVaultServiceAction(state.itemId, values, authMethodId) : await addVaultServiceAction({ slug: key, values, authMethodId, agentIds: state.agentIds })
            if (!res.ok) return res
            state.itemId = res.result.item.id
            state.onItem(res.result.item.id)
            return { ok: true, result: asInstallResult(res.result, name) }
        },
        markAuthorized: async (_agentId, key) => {
            const res = await markVaultEntryAuthorizedAction(key)
            return { success: res.ok }
        },
        // The Vault reads an entry from its own listing and resets it with its own actions.
        details: async () => null,
        reset: async () => ({ ok: false, error: 'Not available in the Vault' }),
    }
}
