import { cn } from '@/lib/utils'
import type { ReactNode, Ref } from 'react'

type TextareaMirrorProps = {
    className: string
    children: ReactNode
    ref?: Ref<HTMLDivElement>
}

export function TextareaMirror({ className, children, ref }: TextareaMirrorProps) {
    return (
        <div ref={ref} className={cn('pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap', className)}>
            {children}
            {'\u200b'}
        </div>
    )
}
