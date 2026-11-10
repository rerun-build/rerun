'use client'

import type { ReactNode } from 'react'

import { cn } from '../cn'
import { Pencil } from '../icons'
import { OptionMark } from './OptionMark'
import { useKitTranslations } from '../locale'

// La ligne qu'on clique pour répondre, et la ligne « autre chose » qui ouvre un champ à la place.
// Extraite de QuestionForm parce que la carte d'accueil du Foreman pose les mêmes questions hors
// d'une conversation : deux copies de ce balisage dériveraient l'une de l'autre, et une réponse au
// Foreman ne se lirait plus comme une réponse à un agent.

const ROW = 'flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent data-[selected=true]:bg-accent aria-disabled:pointer-events-none aria-disabled:opacity-50'

function activate(event: React.KeyboardEvent, choose: () => void) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    choose()
}

export type OptionRowProps = {
    index: number
    label: ReactNode
    description?: ReactNode
    selected: boolean
    multi?: boolean
    disabled?: boolean
    onChoose: () => void
    className?: string
}

export function OptionRow({ index, label, description, selected, multi = false, disabled, onChoose, className }: OptionRowProps) {
    return (
        <div
            role={multi ? 'checkbox' : 'button'}
            aria-checked={multi ? selected : undefined}
            tabIndex={0}
            onClick={onChoose}
            onKeyDown={event => activate(event, onChoose)}
            data-selected={selected}
            data-hitl={`option-${index}`}
            className={cn(ROW, className)}
            aria-disabled={disabled}
        >
            <OptionMark index={index} selected={selected} multi={multi} />
            {description ? (
                <div className="flex min-h-7 min-w-0 flex-1 flex-col justify-center text-left">
                    <div data-selected={selected} className="text-muted-foreground data-[selected=true]:font-medium data-[selected=true]:text-foreground">
                        {label}
                    </div>
                    <div className="line-clamp-2 text-xs text-muted-foreground/80">{description}</div>
                </div>
            ) : (
                <div data-selected={selected} className="flex min-h-7 min-w-0 flex-1 items-center text-left text-muted-foreground data-[selected=true]:font-medium data-[selected=true]:text-foreground">
                    {label}
                </div>
            )}
        </div>
    )
}

export type CustomOptionRowProps = {
    open: boolean
    onOpen: () => void
    /** Le champ de saisie, rendu à la place du libellé une fois la ligne ouverte. */
    children: ReactNode
    label?: string
    className?: string
}

export function CustomOptionRow({ open, onOpen, children, label, className }: CustomOptionRowProps) {
    const t = useKitTranslations()
    return (
        <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={event => activate(event, onOpen)} data-selected={open} data-hitl="custom" className={cn(ROW, className)}>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                <Pencil className="size-3.5" />
            </span>
            {open ? children : <span className="flex min-h-7 flex-1 items-center text-left text-muted-foreground">{label ?? t('chat.question.somethingElse')}</span>}
        </div>
    )
}
