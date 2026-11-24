'use client'

import type { ComponentType } from 'react'
import { cn } from '../cn'
import { BorderBeam } from '../BorderBeam'

export type ModeTab<M extends string = string> = { mode: M; label: string; icon: ComponentType<{ className?: string }> }

type ModeTabsProps<M extends string> = {
    tabs: ModeTab<M>[]
    activeMode: M
    onSelect: (mode: M) => void
    className?: string
}

export function ModeTabs<M extends string>({ tabs, activeMode, onSelect, className }: ModeTabsProps<M>) {
    return (
        <div className={cn('flex items-center gap-1', className)}>
            {tabs.map(({ mode: m, label, icon: Icon }) => {
                const active = activeMode === m
                return (
                    <button key={m} onClick={() => onSelect(m)} className={cn('group relative flex items-center px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors', active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground')}>
                        {active && <BorderBeam animated pattern="arcs" tone="white" glow duration={11} />}
                        <Icon className="size-4 shrink-0" />
                        <span className={cn('grid overflow-hidden transition-[grid-template-columns] duration-300 ease-out', active ? 'grid-cols-[1fr]' : 'grid-cols-[0fr] group-hover:grid-cols-[1fr]')}>
                            <span className="min-w-0 overflow-hidden whitespace-nowrap ps-1.5">{label}</span>
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
