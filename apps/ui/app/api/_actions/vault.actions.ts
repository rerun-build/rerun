'use server'

import type { VaultItemSummary } from '@rerun/contracts'

import { addVaultMcp, addVaultSecret, addVaultService, reconfigureVaultService, vaultCatalog, vaultPopularApps, type AddVaultMcpInput, type AddVaultSecretInput, type AddVaultServiceInput, type VaultAddResult, type VaultCatalogApp } from '@/app/api/_services/vault-install.service'
import { requireLightSessionActor } from '@/app/api/_auth/access'
import { attachVaultPaidAccount, detachVaultPaidAccount, vaultPaidAccounts, type VaultPaidAccount } from '@/app/api/_services/vault-apps.service'
import { isAppSlug } from '@/lib/apps/types'
import {
    attachVaultEntry,
    deleteVaultEntry,
    detachVaultEntry,
    listVault,
    markVaultEntryAuthorized,
    shareVaultEntry,
    vaultEntryUsage,
    vaultSignedOutCount,
    coworkerVault,
    type CoworkerVault,
    type VaultCoworker,
    type VaultListing,
} from '@/app/api/_services/vault.service'
import { failureOf, type ActionFailure } from '@/lib/i18n/action-error'

type Result<T> = { ok: true; result: T } | ActionFailure

async function attempt<T>(run: () => Promise<T>): Promise<Result<T>> {
    try {
        return { ok: true, result: await run() }
    } catch (err) {
        return failureOf(err)
    }
}

export async function listVaultAction(): Promise<Result<VaultListing>> {
    return attempt(() => listVault())
}

export async function addVaultServiceAction(input: AddVaultServiceInput): Promise<Result<VaultAddResult>> {
    return attempt(() => addVaultService(input))
}

export async function reconfigureVaultServiceAction(itemId: string, values: Record<string, string>, authMethodId?: string): Promise<Result<VaultAddResult>> {
    return attempt(() => reconfigureVaultService(itemId, values, authMethodId))
}

export async function attachVaultEntryAction(itemId: string, agentId: string): Promise<Result<VaultItemSummary>> {
    return attempt(() => attachVaultEntry(itemId, agentId))
}

export async function detachVaultEntryAction(itemId: string, agentId: string): Promise<Result<VaultItemSummary>> {
    return attempt(() => detachVaultEntry(itemId, agentId))
}

export async function shareVaultEntryAction(itemId: string, sharedWithAll: boolean): Promise<Result<VaultItemSummary>> {
    return attempt(() => shareVaultEntry(itemId, sharedWithAll))
}

export async function vaultEntryUsageAction(itemId: string): Promise<Result<{ coworkers: VaultCoworker[]; hidden: number }>> {
    return attempt(() => vaultEntryUsage(itemId))
}

export async function deleteVaultEntryAction(itemId: string): Promise<Result<{ detached: VaultCoworker[] }>> {
    return attempt(() => deleteVaultEntry(itemId))
}

export async function markVaultEntryAuthorizedAction(itemId: string): Promise<Result<VaultItemSummary>> {
    return attempt(() => markVaultEntryAuthorized(itemId))
}

export async function vaultCatalogAction(query?: string): Promise<Result<VaultCatalogApp[]>> {
    return attempt(async () => {
        await requireLightSessionActor()
        return vaultCatalog(query)
    })
}

export async function vaultPopularAppsAction(): Promise<Result<VaultCatalogApp[]>> {
    return attempt(async () => {
        await requireLightSessionActor()
        return vaultPopularApps()
    })
}

export async function vaultSignedOutCountAction(): Promise<number> {
    return vaultSignedOutCount()
}

export async function coworkerVaultAction(agentId: string): Promise<CoworkerVault | null> {
    try {
        return await coworkerVault(agentId)
    } catch {
        return null
    }
}

export async function addVaultSecretAction(input: AddVaultSecretInput): Promise<Result<VaultItemSummary>> {
    return attempt(() => addVaultSecret(input))
}

export async function addVaultMcpAction(input: AddVaultMcpInput): Promise<Result<VaultItemSummary>> {
    return attempt(() => addVaultMcp(input))
}

export async function vaultPaidAccountsAction(): Promise<Result<VaultPaidAccount[]>> {
    return attempt(() => vaultPaidAccounts())
}

export async function attachVaultPaidAccountAction(slug: string, connectionId: string, agentId: string): Promise<Result<null>> {
    return attempt(async () => {
        if (!isAppSlug(slug)) throw new Error('Unknown paid app')
        await attachVaultPaidAccount(slug, connectionId, agentId)
        return null
    })
}

export async function detachVaultPaidAccountAction(slug: string, connectionId: string, agentId: string): Promise<Result<null>> {
    return attempt(async () => {
        if (!isAppSlug(slug)) throw new Error('Unknown paid app')
        await detachVaultPaidAccount(slug, connectionId, agentId)
        return null
    })
}
