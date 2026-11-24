'use client'

import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'

import { cn } from '../cn'
import { BorderBeam } from '../BorderBeam'

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
    return (
        <SwitchPrimitive.Root
            data-slot="switch"
            className={cn(
                'group peer relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-[colors,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=unchecked]:bg-muted data-[state=unchecked]:inset-ring data-[state=unchecked]:inset-ring-border data-[state=checked]:bg-emerald-500/15',
                className
            )}
            {...props}
        >
            <BorderBeam
                tone="green"
                pattern="arcs"
                glow
                radius="9999px"
                className="opacity-0 transition-opacity group-data-[state=checked]:opacity-100"
                animated
            />
            <SwitchPrimitive.Thumb
                className={cn(
                    'pointer-events-none relative block size-4 rounded-full bg-foreground shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4.5 data-[state=unchecked]:translate-x-0.5 rtl:data-[state=checked]:-translate-x-4.5 rtl:data-[state=unchecked]:-translate-x-0.5 data-[state=checked]:bg-emerald-400 data-[state=checked]:shadow-[0_0_8px_2px_rgba(52,211,153,0.7)]'
                )}
            >
                <BorderBeam
                    tone="white"
                    pattern="ring"
                    glow
                    radius="9999px"
                    className="opacity-0 transition-opacity group-data-[state=checked]:opacity-100"
                    animated
                />
            </SwitchPrimitive.Thumb>
        </SwitchPrimitive.Root>
    )
}

export { Switch }
