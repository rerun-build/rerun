'use client'

import { useCallback, useEffect, useState } from 'react'

import { listVaultAction, vaultPaidAccountsAction } from '@/app/api/_actions/vault.actions'
import type { VaultPaidAccount } from '@/app/api/_services/vault-apps.service'
import type { VaultListing } from '@/app/api/_services/vault.service'
import { useErrorText } from '@/hooks/useErrorText'

// The workspace's Vault while its dialog is open: read when it opens, read again after every change,
// since an attachment refused by the engine or a sign-in that just landed is only known there.
export function useVault(open: boolean) {
    const errorText = useErrorText()
    const [listing, setListing] = useState<VaultListing | null>(null)
    const [paid, setPaid] = useState<VaultPaidAccount[]>([])
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async () => {
        const [res, accounts] = await Promise.all([listVaultAction(), vaultPaidAccountsAction()])
        if (res.ok) {
            setListing(res.result)
            setError(null)
        } else {
            setError(errorText(res))
        }
        if (accounts.ok) setPaid(accounts.result)
    }, [errorText])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (open) void reload()
    }, [open, reload])

    return { listing, paid, error, reload }
}
