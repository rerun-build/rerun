import { messagePreview } from '@rerun/contracts'
import { createContext, use, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'

import type { LinkAuthor, LinkOrigin } from '@/lib/in-app-browser'

const Author = createContext<LinkAuthor | null>(null)

// Held in a ref, so a streamed word does not redraw every link of the message.
const MessageText = createContext<RefObject<string> | null>(null)

// A word struck through was replaced by the next one: the line under the page keeps only what stands.
export function excerptOf(markdown: string): string {
    return messagePreview(markdown.replace(/(~{1,2})(?=\S)[^~\n]*?\S\1/g, ''))
}

export function LinkAuthorScope({ author, children }: { author: LinkAuthor; children: ReactNode }) {
    const { id, kind, name, role } = author
    const value = useMemo(() => ({ id, kind, name, role }), [id, kind, name, role])
    return <Author value={value}>{children}</Author>
}

export function LinkMessageScope({ text, children }: { text: string; children: ReactNode }) {
    const source = useRef(text)
    useEffect(() => {
        source.current = text
    }, [text])
    return <MessageText value={source}>{children}</MessageText>
}

// Read at the tap: the message a link was written in, once the conversation and the message are known.
export function useLinkOrigin(): () => LinkOrigin | undefined {
    const author = use(Author)
    const source = use(MessageText)
    return () => {
        if (!author || !source) return undefined
        const excerpt = excerptOf(source.current)
        return excerpt ? { author, excerpt } : undefined
    }
}
