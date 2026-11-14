import { useLayoutEffect, useRef, type RefObject } from 'react'

import type { ConversationHandle } from '@/components/ai-elements/conversation'

const TOP_GAP = 12

export type Arrival = 'measure-later' | 'stick' | 'arrive'

export function arrivalOf(blockHeight: number, threadHeight: number): Arrival {
    if (blockHeight === 0 || threadHeight === 0) return 'measure-later'
    return blockHeight + TOP_GAP <= threadHeight ? 'stick' : 'arrive'
}

export function bringBlockIn(conversation: ConversationHandle, blockEl: HTMLElement, behavior: ScrollBehavior) {
    const scrollEl = conversation.scrollRef.current
    if (!scrollEl) return
    if (arrivalOf(blockEl.offsetHeight, scrollEl.clientHeight) !== 'arrive') {
        void conversation.scrollToBottom(behavior)
        return
    }
    conversation.stopScroll()
    scrollEl.scrollTo({ top: scrollEl.scrollTop + blockEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top - TOP_GAP, behavior })
}

export function useArriveByTop(conversationRef: RefObject<ConversationHandle | null>, key: string | null) {
    const blockRef = useRef<HTMLDivElement | null>(null)

    useLayoutEffect(() => {
        const blockEl = blockRef.current
        if (key === null || !blockEl) return
        let frame = 0
        const observer = new ResizeObserver(() => {
            const conversation = conversationRef.current
            const scrollEl = conversation?.scrollRef.current
            if (!conversation || !scrollEl) return
            if (arrivalOf(blockEl.offsetHeight, scrollEl.clientHeight) !== 'arrive') return
            observer.disconnect()
            frame = requestAnimationFrame(() => bringBlockIn(conversation, blockEl, 'instant'))
        })
        observer.observe(blockEl)
        return () => {
            observer.disconnect()
            cancelAnimationFrame(frame)
        }
    }, [conversationRef, key])

    return blockRef
}
