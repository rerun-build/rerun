'use client'

import { useCallback, useEffect, useState } from 'react'

import { listVaultAction } from '@/app/api/_actions/vault.actions'
import type { VaultListing } from '@/app/api/_services/vault.service'
import { useErrorText } from '@/hooks/useErrorText'

// The workspace's Vault while its dialog is open: read when it opens, read again after every change,
// since an attachment refused by the engine or a sign-in that just landed is only known there.
export function useVault(open: boolean) {
    const errorText = useErrorText()
    const [listing, setListing] = useState<VaultListing | null>(null)
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async () => {
        const res = await listVaultAction()
        if (res.ok) {
            setListing(res.result)
            setError(null)
        } else {
            setError(errorText(res))
        }
    }, [errorText])

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (open) void reload()
    }, [open, reload])

    return { listing, error, reload }
}
