'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_IN_FLIGHT = 4
const NO_HEADS: Record<string, string> = {}

type Cache = { key: string; heads: Record<string, string> }
type Queue = { key: string; paths: string[]; inFlight: number; requested: Set<string> }

type Options = {
    read: (path: string) => Promise<string>
    resetKey: string
}

export function useFileThumbnails({ read, resetKey }: Options) {
    const [cache, setCache] = useState<Cache>({ key: resetKey, heads: NO_HEADS })
    const queue = useRef<Queue>({ key: resetKey, paths: [], inFlight: 0, requested: new Set() })

    if (cache.key !== resetKey) setCache({ key: resetKey, heads: NO_HEADS })

    const request = useCallback(
        (path: string) => {
            const q = queue.current
            if (q.key !== resetKey) {
                q.key = resetKey
                q.paths = []
                q.inFlight = 0
                q.requested = new Set()
            }
            if (q.requested.has(path)) return
            q.requested.add(path)
            q.paths.push(path)

            const store = (target: string, head: string) => {
                setCache(prev => (prev.key === resetKey ? { key: prev.key, heads: { ...prev.heads, [target]: head } } : prev))
            }

            const startNext = () => {
                if (q.key !== resetKey || q.inFlight >= MAX_IN_FLIGHT || q.paths.length === 0) return
                const next = q.paths.shift()!
                q.inFlight += 1
                read(next)
                    .then(head => store(next, head))
                    .catch(() => store(next, ''))
                    .finally(() => {
                        q.inFlight -= 1
                        startNext()
                    })
            }

            while (q.inFlight < MAX_IN_FLIGHT && q.paths.length > 0) startNext()
        },
        [read, resetKey]
    )

    return { heads: cache.key === resetKey ? cache.heads : NO_HEADS, request }
}

export function useInViewport<T extends Element>(ref: { current: T | null }) {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        const el = ref.current
        if (!el || visible) return
        const observer = new IntersectionObserver(
            entries => {
                if (entries.some(entry => entry.isIntersecting)) setVisible(true)
            },
            { rootMargin: '200px' }
        )
        observer.observe(el)
        return () => observer.disconnect()
    }, [ref, visible])

    return visible
}
