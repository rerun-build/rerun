'use client'

import type { ComponentProps, ReactNode } from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'
import { cn } from './cn'

export function TooltipLabeled({
    label,
    children,
    side = 'top',
    align,
    delayDuration = 0,
    contentClassName,
}: {
    label: ReactNode
    children: ReactNode
    side?: ComponentProps<typeof TooltipPrimitive.Content>['side']
    align?: ComponentProps<typeof TooltipPrimitive.Content>['align']
    delayDuration?: number
    contentClassName?: string
}) {
    return (
        <TooltipPrimitive.Provider delayDuration={delayDuration}>
            <TooltipPrimitive.Root>
                <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
                <TooltipPrimitive.Portal>
                    <TooltipPrimitive.Content
                        side={side}
                        align={align}
                        sideOffset={6}
                        className={cn(
                            'z-50 inline-flex w-fit max-w-xs items-center rounded-md bg-foreground px-3 py-1.5 text-xs text-background data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95',
                            contentClassName
                        )}
                    >
                        {label}
                        <TooltipPrimitive.Arrow className="size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground" />
                    </TooltipPrimitive.Content>
                </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
    )
}

export function TooltipDisabledReason({
    reason,
    children,
    side,
    className,
}: {
    reason?: string
    children: ReactNode
    side?: ComponentProps<typeof TooltipPrimitive.Content>['side']
    className?: string
}) {
    if (!reason) return <>{children}</>

    return (
        <TooltipLabeled label={reason} side={side}>
            <span tabIndex={0} className={cn('inline-flex cursor-not-allowed rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50', className)}>
                {children}
            </span>
        </TooltipLabeled>
    )
}
