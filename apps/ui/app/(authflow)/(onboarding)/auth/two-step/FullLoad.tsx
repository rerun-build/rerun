'use client'

import { useEffect } from 'react'

// Leaves by a full page load: the proxy then trades the session's token, which still carries the flag
// of a two-step just turned off, for a fresh one. A navigation of the router would keep the old token
// and be sent back here.
export function FullLoad({ to }: { to: string }) {
    useEffect(() => {
        window.location.replace(to)
    }, [to])
    return null
}
