'use client'

import { BoxIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

export function NameChips({ names, picked, onPick, className }: { names: string[]; picked: string | null; onPick: (name: string) => void; className?: string }) {
    if (names.length === 0) return null

    return (
        <div className={cn('flex flex-wrap justify-center gap-2', className)}>
            {names.map(name => {
                const lit = picked === name
                return (
                    <button key={name} type="button" data-pick={name} onClick={() => onPick(name)} className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] ring-1 transition duration-200', lit ? 'bg-popover text-foreground ring-black/[0.11] dark:bg-[color-mix(in_oklab,var(--background),white_10%)] dark:ring-white/[0.14]' : 'bg-popover text-foreground/75 ring-black/[0.06] hover:text-foreground dark:bg-[color-mix(in_oklab,var(--background),white_5.5%)] dark:ring-0')}>
                        <BoxIcon className={cn('size-3.5', lit ? 'text-foreground' : 'text-muted-foreground')} />
                        {name}
                    </button>
                )
            })}
        </div>
    )
}
