'use client'

import { useCallback, useEffect, useRef } from 'react'

export function readOAuthPopupResult<T extends { type: string }>(raw: unknown, known: ReadonlySet<string>, accept?: (data: T) => boolean): T | null {
    const data = raw as { type?: unknown } | null | undefined
    if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !known.has(data.type)) return null
    if (accept && !accept(data as T)) return null
    return data as T
}

export function useOAuthPopupResult<T extends { type: string }>(channelName: string, types: readonly string[], onResult: (data: T) => void, accept?: (data: T) => boolean): () => void {
    const onResultRef = useRef(onResult)
    onResultRef.current = onResult
    const acceptRef = useRef(accept)
    acceptRef.current = accept
    const deliveredRef = useRef(false)
    const typeKey = types.join('|')

    useEffect(() => {
        const known = new Set(typeKey.split('|'))
        const deliver = (raw: unknown) => {
            const data = readOAuthPopupResult<T>(raw, known, acceptRef.current)
            if (!data || deliveredRef.current) return
            deliveredRef.current = true
            onResultRef.current(data)
        }
        const handleMessage = (event: MessageEvent) => deliver(event.data)
        window.addEventListener('message', handleMessage)
        let channel: BroadcastChannel | null = null
        try {
            channel = new BroadcastChannel(channelName)
            channel.onmessage = event => deliver(event.data)
        } catch {
            channel = null
        }
        return () => {
            window.removeEventListener('message', handleMessage)
            channel?.close()
        }
    }, [channelName, typeKey])

    return useCallback(() => {
        deliveredRef.current = false
    }, [])
}
