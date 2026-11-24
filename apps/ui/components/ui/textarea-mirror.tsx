import { cn } from '@/lib/utils'
import type { ReactNode, Ref } from 'react'

type TextareaMirrorProps = {
    /** Must carry the textarea's exact typography and padding, otherwise the tokens drift off their text. */
    className: string
    children: ReactNode
    ref?: Ref<HTMLDivElement>
}

/**
 * Laid over a textarea whose own text is transparent: the textarea keeps the caret, the selection
 * and the input, the mirror draws the same text with some runs styled as tokens. A textarea that
 * scrolls has to copy its `scrollTop` onto the mirror.
 */
export function TextareaMirror({ className, children, ref }: TextareaMirrorProps) {
    return (
        <div ref={ref} dir="auto" className={cn('pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap', className)}>
            {children}
            {/* A trailing newline only gets a line of its own when something follows it, as it does in the textarea. */}
            {'\u200b'}
        </div>
    )
}
