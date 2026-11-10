'use client'

import { MAX_UPLOAD_FILE_BYTES } from '@rerun/contracts'
import type { UploadEntry } from '@/lib/files/upload'
import { uploadUrl, type UploadTarget } from '@/lib/files/upload-url'
import { UploadAbortedError, UploadHttpError, UploadNetworkError, xhrUpload, type XhrUploadHandle } from '@/lib/files/upload-client'
import { nanoid } from 'nanoid'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export type UploadStatus = 'queued' | 'uploading' | 'finishing' | 'done' | 'error'

export type UploadItem = {
    id: string
    name: string
    dir: string
    path: string
    size: number
    status: UploadStatus
    loaded: number
    progress: number
    etaMs: number | null
    error: string | null
}

export type { UploadTarget }

export type UseFileUploadsOptions = {
    target: UploadTarget
    concurrency?: number
    nameFor?: (file: File) => string
    onFileDone?: (item: UploadItem) => void
    onRejected?: (message: string) => void
}

// `bytesPerSecond` ne sort pas du job : plus rien ne l'affiche, il ne sert qu'à lisser l'ETA.
type Job = UploadItem & { file: File; attempt: number; bytesPerSecond: number | null }

const MB = 1024 * 1024
const PUBLISH_INTERVAL_MS = 100
const SPEED_SMOOTHING = 0.3

function publicItem(job: Job): UploadItem {
    return {
        id: job.id,
        name: job.name,
        dir: job.dir,
        path: job.path,
        size: job.size,
        status: job.status,
        loaded: job.loaded,
        progress: job.progress,
        etaMs: job.etaMs,
        error: job.error,
    }
}

/**
 * Drives one upload request per file so each gets its own progress, cancel and retry. Jobs live in a
 * ref and are published on a timer: progress events fire dozens of times a second per file, and a
 * setState on each one would re-render the whole surrounding panel continuously.
 */
type UploadCopy = ReturnType<typeof useTranslations<'files.uploadOutcome'>>

function uploadErrorText(err: unknown, t: UploadCopy): string {
    if (err instanceof UploadHttpError) {
        if (err.serverMessage) return err.serverMessage
        if (err.status === 401 || err.status === 403) return t('sessionExpired')
        return err.status === 413 ? t('tooLarge') : t('retryLater')
    }
    if (err instanceof UploadNetworkError) return t('networkFailed')
    return t('allFailed')
}

export function useFileUploads({ target, concurrency = 3, nameFor, onFileDone, onRejected }: UseFileUploadsOptions) {
    const t = useTranslations('files.uploadOutcome')
    const jobs = useRef(new Map<string, Job>())
    const handles = useRef(new Map<string, XhrUploadHandle>())
    const [items, setItems] = useState<UploadItem[]>([])

    const mounted = useRef(true)
    const publishTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const waiters = useRef<((items: UploadItem[]) => void)[]>([])

    const callbacks = useRef({ onFileDone, onRejected, target })
    useEffect(() => {
        callbacks.current = { onFileDone, onRejected, target }
    })

    useEffect(() => {
        mounted.current = true
        return () => {
            mounted.current = false
            if (publishTimer.current) clearTimeout(publishTimer.current)
        }
    }, [])

    const publish = useCallback((immediate = false) => {
        if (!mounted.current) return
        if (immediate) {
            if (publishTimer.current) {
                clearTimeout(publishTimer.current)
                publishTimer.current = null
            }
            setItems([...jobs.current.values()].map(publicItem))
            return
        }
        if (publishTimer.current) return
        publishTimer.current = setTimeout(() => {
            publishTimer.current = null
            if (mounted.current) setItems([...jobs.current.values()].map(publicItem))
        }, PUBLISH_INTERVAL_MS)
    }, [])

    const settleWaiters = useCallback(() => {
        const pending = [...jobs.current.values()].some(job => job.status === 'queued' || job.status === 'uploading' || job.status === 'finishing')
        if (pending) return
        const pendingWaiters = waiters.current
        waiters.current = []
        const settled = [...jobs.current.values()].map(publicItem)
        pendingWaiters.forEach(resolve => resolve(settled))
    }, [])

    // `pump` reschedules itself when a slot frees up. The recursion goes through a ref so the callback
    // does not have to reference its own binding before it exists.
    const pumpRef = useRef<() => void>(() => {})

    const pump = useCallback(() => {
        const all = [...jobs.current.values()]
        const running = all.filter(job => job.status === 'uploading' || job.status === 'finishing').length
        const next = all.filter(job => job.status === 'queued').slice(0, Math.max(0, concurrency - running))

        for (const job of next) {
            job.status = 'uploading'
            job.error = null

            let lastAt = Date.now()
            let lastLoaded = 0

            const handle = xhrUpload({
                url: uploadUrl(callbacks.current.target, job.dir, job.name, job.size),
                body: job.file,
                onProgress: (loaded, total) => {
                    const now = Date.now()
                    const elapsed = (now - lastAt) / 1000
                    if (elapsed > 0.15) {
                        const instant = (loaded - lastLoaded) / elapsed
                        // Raw instant speed swings wildly between packets and makes the ETA unreadable.
                        job.bytesPerSecond = job.bytesPerSecond == null ? instant : job.bytesPerSecond * (1 - SPEED_SMOOTHING) + instant * SPEED_SMOOTHING
                        lastAt = now
                        lastLoaded = loaded
                    }
                    job.loaded = loaded
                    job.progress = total > 0 ? loaded / total : 0
                    job.etaMs = job.bytesPerSecond && job.bytesPerSecond > 0 ? ((total - loaded) / job.bytesPerSecond) * 1000 : null
                    publish()
                },
                onSent: () => {
                    if (job.status !== 'uploading') return
                    job.status = 'finishing'
                    job.progress = 1
                    publish(true)
                },
            })
            handles.current.set(job.id, handle)

            handle.promise
                .then(() => {
                    handles.current.delete(job.id)
                    job.status = 'done'
                    job.loaded = job.size
                    job.progress = 1
                    job.etaMs = null
                    publish(true)
                    callbacks.current.onFileDone?.(publicItem(job))
                })
                .catch((err: unknown) => {
                    handles.current.delete(job.id)
                    if (err instanceof UploadAbortedError) {
                        jobs.current.delete(job.id)
                        publish(true)
                        return
                    }
                    // Only a dropped connection is worth retrying on its own; a refusal would just be
                    // refused again, and repeating it hides the message the user needs to read.
                    const retriable = !(err instanceof UploadHttpError) && job.attempt === 0
                    if (retriable) {
                        job.attempt += 1
                        job.status = 'queued'
                        job.loaded = 0
                        job.progress = 0
                        publish(true)
                        setTimeout(() => pumpRef.current(), 1000)
                        return
                    }
                    job.status = 'error'
                    job.error = uploadErrorText(err, t)
                    publish(true)
                })
                .finally(() => {
                    settleWaiters()
                    pumpRef.current()
                })
        }

        publish(true)
        settleWaiters()
    }, [concurrency, publish, settleWaiters, t])

    useEffect(() => {
        pumpRef.current = pump
    })

    const enqueue = useCallback(
        (entries: UploadEntry[], rootDir = ''): string[] => {
            const accepted: string[] = []
            const oversized: string[] = []

            for (const { file, subDir } of entries) {
                if (file.size > MAX_UPLOAD_FILE_BYTES) {
                    oversized.push(file.name)
                    continue
                }
                const id = nanoid()
                const name = nameFor?.(file) ?? file.name.split(/[\\/]/).pop() ?? file.name
                const dir = [rootDir, subDir].filter(Boolean).join('/')
                jobs.current.set(id, {
                    id,
                    file,
                    name,
                    dir,
                    path: [dir, name].filter(Boolean).join('/'),
                    size: file.size,
                    status: 'queued',
                    loaded: 0,
                    progress: 0,
                    bytesPerSecond: null,
                    etaMs: null,
                    error: null,
                    attempt: 0,
                })
                accepted.push(id)
            }

            if (oversized.length) {
                const names = oversized.slice(0, 2).join(', ')
                callbacks.current.onRejected?.(t('oversized', { names, more: Math.max(0, oversized.length - 2), count: oversized.length, limit: MAX_UPLOAD_FILE_BYTES / MB }))
            }

            pump()
            return accepted
        },
        [nameFor, pump, t],
    )

    const cancel = useCallback(
        (id: string) => {
            const handle = handles.current.get(id)
            if (handle) {
                handle.abort()
                return
            }
            jobs.current.delete(id)
            publish(true)
            settleWaiters()
        },
        [publish, settleWaiters],
    )

    const cancelAll = useCallback(() => {
        for (const id of [...jobs.current.keys()]) cancel(id)
    }, [cancel])

    const retry = useCallback(
        (id: string) => {
            const job = jobs.current.get(id)
            if (!job || job.status !== 'error') return
            job.status = 'queued'
            job.attempt = 0
            job.loaded = 0
            job.progress = 0
            job.error = null
            job.bytesPerSecond = null
            pump()
        },
        [pump],
    )

    const clearFinished = useCallback(() => {
        for (const [id, job] of [...jobs.current.entries()]) {
            if (job.status === 'done') jobs.current.delete(id)
        }
        publish(true)
    }, [publish])

    // Resolves once nothing is in flight, with the final state of every job. The chat composer waits
    // on this so a send typed mid-upload leaves on its own when the last byte lands. It resolves with
    // the items rather than relying on `items`, which is still the pre-await render's value there.
    const waitForAll = useCallback((): Promise<UploadItem[]> => {
        const pending = [...jobs.current.values()].some(job => job.status === 'queued' || job.status === 'uploading' || job.status === 'finishing')
        if (!pending) return Promise.resolve([...jobs.current.values()].map(publicItem))
        // oxlint-disable-next-line eslint-plugin-promise(avoid-new)
        return new Promise(resolve => waiters.current.push(resolve))
    }, [])

    const byId = useMemo(() => new Map(items.map(item => [item.id, item])), [items])
    const active = items.some(item => item.status === 'queued' || item.status === 'uploading' || item.status === 'finishing')

    const totalProgress = useMemo(() => {
        const total = items.reduce((sum, item) => sum + item.size, 0)
        if (total === 0) return 0
        return items.reduce((sum, item) => sum + item.loaded, 0) / total
    }, [items])

    return { items, byId, active, totalProgress, enqueue, cancel, cancelAll, retry, clearFinished, waitForAll }
}

export type FileUploads = ReturnType<typeof useFileUploads>
