'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { dismissUpdateAvailableToast, showUpdateAvailableToast } from './showUpdateAvailableToast'
import { UpdateRequiredDialog } from './UpdateRequiredDialog'

const BUILD_SHA = process.env.NEXT_PUBLIC_BUILD_SHA
const VERSION_CHECK_INTERVAL_MS = 5 * 60_000
const ACTION_NOT_FOUND_HEADER = 'x-nextjs-action-not-found'
const CHUNK_LOAD_FAILURE = /Loading chunk|Failed to load chunk|ChunkLoadError/
const UNATTENDED_RELOAD_KEY = 'deploy-update-reloaded-at'
const UNATTENDED_RELOAD_COOLDOWN_MS = 10 * 60_000

// Nobody is looking at a hidden tab, so it catches up with the deploy on its own and its owner
// comes back to a working app instead of a failed action. The cooldown keeps a build that never
// matches its own /api/version from reloading in a loop.
function reloadIfUnattended() {
    if (document.visibilityState !== 'hidden') return
    const reloadedAt = Number(sessionStorage.getItem(UNATTENDED_RELOAD_KEY))
    if (Date.now() - reloadedAt < UNATTENDED_RELOAD_COOLDOWN_MS) return
    sessionStorage.setItem(UNATTENDED_RELOAD_KEY, String(Date.now()))
    window.location.reload()
}

function isChunkLoadError(error: unknown) {
    if (!(error instanceof Error)) return false
    return error.name === 'ChunkLoadError' || CHUNK_LOAD_FAILURE.test(error.message)
}

export function DeployUpdateWatcher() {
    const t = useTranslations('layout.update')
    const [stale, setStale] = useState(false)

    useEffect(() => {
        const originalFetch = window.fetch
        // Callers usually swallow a failed server action in their own catch, so the stale deploy is
        // caught on the response itself, before Next turns it into an UnrecognizedActionError.
        window.fetch = async (...args) => {
            const response = await originalFetch(...args)
            if (response.headers.get(ACTION_NOT_FOUND_HEADER) === '1') setStale(true)
            return response
        }

        const onError = (event: ErrorEvent) => {
            if (isChunkLoadError(event.error)) setStale(true)
        }
        const onRejection = (event: PromiseRejectionEvent) => {
            if (isChunkLoadError(event.reason)) setStale(true)
        }
        window.addEventListener('error', onError)
        window.addEventListener('unhandledrejection', onRejection)

        return () => {
            window.fetch = originalFetch
            window.removeEventListener('error', onError)
            window.removeEventListener('unhandledrejection', onRejection)
        }
    }, [])

    useEffect(() => {
        if (stale) {
            dismissUpdateAvailableToast()
            reloadIfUnattended()
            document.addEventListener('visibilitychange', reloadIfUnattended)
            return () => document.removeEventListener('visibilitychange', reloadIfUnattended)
        }

        const checkVersion = async () => {
            try {
                const response = await fetch('/api/version', { cache: 'no-store' })
                if (!response.ok) return
                const { buildSha } = (await response.json()) as { buildSha?: string }
                if (!buildSha || buildSha === BUILD_SHA) return
                if (document.visibilityState === 'hidden') reloadIfUnattended()
                else showUpdateAvailableToast({ title: t('available.title'), description: t('available.description'), reload: t('reload') })
            } catch {}
        }

        const interval = window.setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS)
        document.addEventListener('visibilitychange', checkVersion)
        return () => {
            window.clearInterval(interval)
            document.removeEventListener('visibilitychange', checkVersion)
        }
    }, [stale, t])

    return <UpdateRequiredDialog open={stale} />
}
