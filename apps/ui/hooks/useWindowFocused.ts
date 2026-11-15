'use client'

import { useEffect, useState } from 'react'

export function useWindowFocused(): boolean {
    const [focused, setFocused] = useState(true)

    useEffect(() => {
        const sync = () => setFocused(document.hasFocus())
        sync()
        window.addEventListener('focus', sync)
        window.addEventListener('blur', sync)
        return () => {
            window.removeEventListener('focus', sync)
            window.removeEventListener('blur', sync)
        }
    }, [])

    return focused
}
