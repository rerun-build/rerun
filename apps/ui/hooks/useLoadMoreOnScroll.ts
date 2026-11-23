import { useEffect, type RefObject } from 'react'

type LoadMoreOnScroll = {
    sentinelRef: RefObject<Element | null>
    // The scrolling element the sentinel lives in; the viewport when it is left out.
    rootRef?: RefObject<Element | null>
    enabled: boolean
    // How much is loaded: the observer is recreated when it changes, so a page too short to push the
    // sentinel out of view still asks for the next one.
    loaded: number
    loadMore: () => void
}

/** Calls `loadMore` while the sentinel at the end of a list is within 200px of being seen. */
export function useLoadMoreOnScroll({ sentinelRef, rootRef, enabled, loaded, loadMore }: LoadMoreOnScroll) {
    useEffect(() => {
        if (!enabled) return
        const sentinel = sentinelRef.current
        if (!sentinel) return
        const observer = new IntersectionObserver(entries => entries[0]?.isIntersecting && loadMore(), { root: rootRef?.current ?? null, rootMargin: '200px' })
        observer.observe(sentinel)
        return () => observer.disconnect()
    }, [enabled, loaded, loadMore, sentinelRef, rootRef])
}
