'use client'

import { useFileUploads, type UploadTarget } from '@/hooks/useFileUploads'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef } from 'react'
import { toast } from 'sonner'

type UsePanelUploadsOptions = {
    target: UploadTarget
    currentPath: string
    onDirectoryChanged: (path: string) => void
}

const RELOAD_DEBOUNCE_MS = 500

export function usePanelUploads({ target, currentPath, onDirectoryChanged }: UsePanelUploadsOptions) {
    const t = useTranslations('files.uploadOutcome')
    const pathRef = useRef(currentPath)
    const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const onDirectoryChangedRef = useRef(onDirectoryChanged)

    useEffect(() => {
        pathRef.current = currentPath
        onDirectoryChangedRef.current = onDirectoryChanged
    })

    useEffect(
        () => () => {
            if (reloadTimer.current) clearTimeout(reloadTimer.current)
        },
        [],
    )

    const scheduleReload = useCallback((dir: string) => {
        if (dir !== pathRef.current) return
        if (reloadTimer.current) clearTimeout(reloadTimer.current)
        reloadTimer.current = setTimeout(() => {
            reloadTimer.current = null
            onDirectoryChangedRef.current(pathRef.current)
        }, RELOAD_DEBOUNCE_MS)
    }, [])

    const uploads = useFileUploads({
        target,
        onFileDone: item => scheduleReload(item.dir),
        onRejected: message => toast.error(message),
    })

    const settledRef = useRef(false)
    const { items, active } = uploads
    useEffect(() => {
        if (items.length === 0) {
            settledRef.current = false
            return
        }
        if (active || settledRef.current) return
        settledRef.current = true

        const failed = items.filter(item => item.status === 'error').length
        if (failed) toast.error(failed === items.length ? t('allFailed') : t('someFailed', { failed, total: items.length }))
        else toast.success(t('uploaded', { count: items.length }))
    }, [items, active, t])

    return uploads
}
