'use client'

import type { ComponentProps } from 'react'

import { UsageRing } from '@/components/agent/UsageRing'
import type { PillUsage } from '@/lib/engine/ai-sources'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { ChevronDownIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

type ModelPillTriggerProps = ComponentProps<'button'> & { provider?: string | null; label: string; usage?: PillUsage | null; usageLabel?: string | null }

/**
 * The model pill in a composer footer. Shared shell so the agent chat's picker and the foreman's
 * fixed "Rerun Balanced" read as the same control: one opens a popover, the other opens nothing.
 * `type="button"` matters, the pill lives inside the composer's form.
 */
export function ModelPillTrigger({ provider, label, usage, usageLabel, className, ...props }: ModelPillTriggerProps) {
    return (
        <button
            type="button"
            aria-label={usage && usageLabel ? `${label}, ${usageLabel}` : undefined}
            className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground disabled:pointer-events-none',
                className
            )}
            {...props}
        >
            {usage ? (
                <UsageRing usage={usage}>
                    <ProviderIcon provider={provider} />
                </UsageRing>
            ) : (
                <ProviderIcon provider={provider} className="size-3.5" />
            )}
            {label}
            <ChevronDownIcon className="size-3" />
        </button>
    )
}
