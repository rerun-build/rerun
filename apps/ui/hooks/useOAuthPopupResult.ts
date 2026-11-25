'use client'

import { useCallback, useEffect, useRef } from 'react'

// A message this listener should act on, or null. `accept` lets a listener that shares its
// channel with others (several Connect buttons of one app) keep only the result meant for it.
export function readOAuthPopupResult<T extends { type: string }>(raw: unknown, known: ReadonlySet<string>, accept?: (data: T) => boolean): T | null {
    const data = raw as { type?: unknown } | null | undefined
    if (!data || typeof data !== 'object' || typeof data.type !== 'string' || !known.has(data.type)) return null
    if (accept && !accept(data as T)) return null
    return data as T
}

// The OAuth callback page publishes its result twice on purpose — once on a same-origin
// BroadcastChannel, once via window.opener.postMessage — because providers that set
// Cross-Origin-Opener-Policy sever the opener and would otherwise never deliver it. Both
// usually land, so the outcome has to be collapsed here: a second delivery must not run the
// caller's success path again (it would answer the agent twice and start two runs).
// A message `accept` refuses was meant for another listener, so it leaves the slot open.
//
// Returns an arm() to call right before opening the popup, so a retry after a failed attempt
// is heard again.
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
        // The callback page always comes back to the app's own origin before it speaks: any other window
        // that holds this one could only fake a result.
        const handleMessage = (event: MessageEvent) => {
            if (event.origin === window.location.origin) deliver(event.data)
        }
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
