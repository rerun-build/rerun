'use client'

import { Button } from '@/components/ui/button'
import { CheckIcon, CopyIcon } from '@/lib/icons'
import { useCopy } from '@/lib/use-copy'
import { cn } from '@/lib/utils'

export function CopyLine({ value, label, className }: { value: string; label: string; className?: string }) {
    const { copied, copy } = useCopy()

    return (
        <div className={cn('flex min-w-0 items-center gap-1.5', className)}>
            <code className="no-scrollbar block h-8 min-w-0 flex-1 overflow-x-auto rounded-md border border-input bg-muted/40 px-3 font-mono text-xs leading-8 whitespace-nowrap">{value}</code>
            <Button size="icon-sm" variant="outline" aria-label={label} onClick={() => copy(value)}>
                {copied ? <CheckIcon className="size-3.5 text-emerald-500" /> : <CopyIcon className="size-3.5" />}
            </Button>
        </div>
    )
}
