import { useEffect, useRef, useState } from 'react'

// Holds back what would lose an unsaved draft: the browser asks about the tab being closed, and a
// click on a link of the page is kept until the caller's dialog lets it through.
export function useUnsavedGuard(dirty: boolean) {
    const [heldLink, setHeldLink] = useState<HTMLAnchorElement | null>(null)
    const leaving = useRef(false)

    useEffect(() => {
        if (!dirty) return
        const warn = (event: BeforeUnloadEvent) => {
            if (!leaving.current) event.preventDefault()
        }
        const hold = (event: MouseEvent) => {
            if (leaving.current || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
            if (!link || link.target === '_blank') return
            event.preventDefault()
            event.stopPropagation()
            setHeldLink(link)
        }
        window.addEventListener('beforeunload', warn)
        document.addEventListener('click', hold, true)
        return () => {
            window.removeEventListener('beforeunload', warn)
            document.removeEventListener('click', hold, true)
        }
    }, [dirty])

    return {
        asking: heldLink !== null,
        stay: () => setHeldLink(null),
        // Let through for this one click: a link that leads nowhere else (the page's own tab) leaves
        // the draft where it is, and the next one is held again.
        leave: () => {
            leaving.current = true
            setHeldLink(null)
            heldLink?.click()
            setTimeout(() => {
                leaving.current = false
            })
        },
    }
}
