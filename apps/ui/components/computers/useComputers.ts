'use client'

import { useCallback, useEffect, useState } from 'react'

import { listComputersAction } from '@/app/api/_actions/remote-computers.actions'
import { useErrorText } from '@/hooks/useErrorText'
import type { ComputersList } from '@/lib/computers/types'

const POLL_MS = 10_000

// The workspace's computers while the dialog is open, read again every ten seconds: online or not is
// what the box says now, and a computer goes offline on its own.
export function useComputers(open: boolean) {
    const errorText = useErrorText()
    const [list, setList] = useState<ComputersList | null>(null)
    const [error, setError] = useState<string | null>(null)

    const reload = useCallback(async () => {
        const res = await listComputersAction()
        if (res.ok) {
            setList({ computers: res.computers, engine: res.engine })
            setError(null)
        } else {
            setError(errorText(res))
        }
    }, [errorText])

    useEffect(() => {
        if (!open) return
        void reload()
        const timer = setInterval(() => {
            if (document.visibilityState === 'visible') void reload()
        }, POLL_MS)
        return () => clearInterval(timer)
    }, [open, reload])

    return { list, error, reload }
}
