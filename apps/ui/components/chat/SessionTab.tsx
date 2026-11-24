'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { MessageSquareIcon, XIcon } from '@/lib/icons'

type SessionTabProps = {
    uid: string
    title: string
    active: boolean
    onClick: () => void
    onClose: () => void
}

export function SessionTab({ uid, title, active, onClick, onClose }: SessionTabProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: uid })

    return (
        <button
            ref={setNodeRef}
            data-active={active}
            style={{ transform: CSS.Translate.toString(transform), transition }}
            {...attributes}
            {...listeners}
            className={cn(
                'group relative flex items-center gap-1.5 px-3 py-2.5 text-xs whitespace-nowrap transition-colors',
                'border-e border-border',
                active
                    ? 'bg-background text-foreground'
                    : 'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
                isDragging && 'z-10 cursor-grabbing shadow-lg'
            )}
            onClick={onClick}
        >
            {active && <div className="absolute inset-x-0 top-0 h-[2px] bg-primary" />}
            <MessageSquareIcon className="size-3 shrink-0" />
            <span className="max-w-[120px] truncate">{title}</span>
            <span
                className={cn(
                    'ms-1 rounded-sm p-0.5 transition-opacity hover:bg-accent',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                )}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => {
                    e.stopPropagation()
                    onClose()
                }}
                role="button"
            >
                <XIcon className="size-3" />
            </span>
        </button>
    )
}
