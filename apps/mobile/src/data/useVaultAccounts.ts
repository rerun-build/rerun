import { FOREMAN_AGENT_ID, type CoworkerVaultAccounts, type VaultAccount } from '@rerun/contracts'
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'use-intl'

import { lendVaultAccount, readVaultAccounts } from '@/api/vault'
import { useAuth } from '@/auth/AuthProvider'

const NONE: CoworkerVaultAccounts = { canAttach: false, accounts: [] }

export type VaultLending = {
    accountsFor: (slug: string) => VaultAccount[]
    canAttach: boolean
    // The account being lent, while the hub answers.
    lending: string | null
    errorFor: (slug: string) => string | null
    // Resolves true once the coworker holds the account.
    lend: (account: VaultAccount) => Promise<boolean>
}

// The Vault's accounts one coworker can be lent instead of signing in to an app again, the web's
// app suggestion's. A Box without a Vault, or a hub that cannot be reached, offers none: the cards
// stay what they were. Nothing is asked while `wanted` is false: a card whose app is connected has no use for it.
export function useVaultAccounts(agentId: string, wanted = true): VaultLending {
    const t = useTranslations('mobileCommon.vault')
    const { session, me } = useAuth()
    const accessToken = session?.access_token
    const workspaceId = me?.workspace.id
    const [vault, setVault] = useState<CoworkerVaultAccounts>(NONE)
    const [lending, setLending] = useState<string | null>(null)
    const [error, setError] = useState<{ slug: string; message: string } | null>(null)

    useEffect(() => {
        if (!wanted || !accessToken || !workspaceId || agentId === FOREMAN_AGENT_ID) return
        let alive = true
        readVaultAccounts({ accessToken, workspaceId }, agentId)
            .then(found => alive && setVault(found))
            .catch(() => {})
        return () => {
            alive = false
        }
    }, [wanted, accessToken, workspaceId, agentId])

    const accountsFor = useCallback((slug: string) => vault.accounts.filter(account => account.slug === slug), [vault])

    const lend = async (account: VaultAccount) => {
        if (!accessToken || !workspaceId || lending || !vault.canAttach) return false
        setLending(account.id)
        setError(null)
        try {
            await lendVaultAccount({ accessToken, workspaceId }, agentId, account.id)
            setVault(current => ({ ...current, accounts: current.accounts.filter(other => other.id !== account.id) }))
            return true
        } catch (err) {
            setError({ slug: account.slug, message: err instanceof Error ? err.message : t('lendFailed') })
            return false
        } finally {
            setLending(null)
        }
    }

    return { accountsFor, canAttach: vault.canAttach, lending, errorFor: slug => (error?.slug === slug ? error.message : null), lend }
}
