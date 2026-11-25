import { useLayoutEffect } from 'react'

import type { PreviewTheme } from '@/ee/lib/organizations/console-routes'

// next-themes writes one theme for every frame of the page: each frame holds on to its own.
export function useFrameTheme(theme: PreviewTheme) {
    useLayoutEffect(() => {
        const root = document.documentElement
        const other = theme === 'dark' ? 'light' : 'dark'
        const hold = () => {
            if (root.classList.contains(theme) && !root.classList.contains(other)) return
            root.classList.remove(other)
            root.classList.add(theme)
            root.style.colorScheme = theme
        }
        hold()
        const observer = new MutationObserver(hold)
        observer.observe(root, { attributes: true, attributeFilter: ['class'] })
        return () => observer.disconnect()
    }, [theme])
}
