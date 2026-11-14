'use client'

import type { ComponentProps, ComponentType, ReactNode, SVGProps } from 'react'
import { BorderBeam } from '../BorderBeam'
import { TooltipDisabledReason } from '../Tooltip'
import { cn } from '../cn'

export const CHROME_SIZE = 40

export type ChromeInset = 'control' | 'avatar' | 'gauge' | 'icon' | 'text'

const INSET_START: Record<ChromeInset, string> = {
    control: 'pl-[3px]',
    avatar: 'pl-[7px]',
    gauge: 'pl-[9px]',
    icon: 'pl-[11px]',
    text: 'pl-[15px]',
}

const INSET_END: Record<ChromeInset, string> = {
    control: 'pr-[3px]',
    avatar: 'pr-[7px]',
    gauge: 'pr-[9px]',
    icon: 'pr-[11px]',
    text: 'pr-[15px]',
}

const SURFACE = 'relative rounded-full border border-border bg-card/95 text-sm font-medium text-foreground shadow-2xl'

type ChromeBeamProps = { beamTone?: 'white' | 'brand'; beamAnimated?: boolean }

function ChromeBeam({ beamTone = 'white', beamAnimated = false }: ChromeBeamProps) {
    return <BorderBeam pattern="arcs" tone={beamTone} animated={beamAnimated} glow angle={53} outset={1} className={beamTone === 'brand' ? 'opacity-50' : 'opacity-30'} />
}

export type ChromePillProps = ComponentProps<'button'> & ChromeBeamProps & { start?: ChromeInset; end?: ChromeInset }

export function ChromePill({ start = 'text', end = 'text', beamTone, beamAnimated, className, children, ...props }: ChromePillProps) {
    return (
        <button
            type="button"
            className={cn(SURFACE, 'flex h-(--chrome-size) shrink-0 items-center gap-2 transition-colors hover:bg-accent', INSET_START[start], INSET_END[end], className)}
            {...props}
        >
            <ChromeBeam beamTone={beamTone} beamAnimated={beamAnimated} />
            {children}
        </button>
    )
}

export type ChromeBarProps = ComponentProps<'div'> & ChromeBeamProps & { orientation?: 'horizontal' | 'vertical'; start?: ChromeInset; end?: ChromeInset }

export function ChromeBar({ orientation = 'horizontal', start = 'control', end = 'control', beamTone, beamAnimated, className, children, ...props }: ChromeBarProps) {
    return (
        <div
            className={cn(
                SURFACE,
                'flex items-center',
                orientation === 'horizontal' ? ['h-(--chrome-size) gap-2', INSET_START[start], INSET_END[end]] : 'w-(--chrome-size) flex-col gap-1 py-[3px]',
                className
            )}
            {...props}
        >
            <ChromeBeam beamTone={beamTone} beamAnimated={beamAnimated} />
            {children}
        </div>
    )
}

export type ChromeButtonProps = ComponentProps<'button'> & {
    icon?: ComponentType<SVGProps<SVGSVGElement>>
    label?: ReactNode
    disabledReason?: string | null
}

export function ChromeButton({ icon: Icon, label, disabledReason, disabled, className, children, ...props }: ChromeButtonProps) {
    const labelled = label !== undefined || children !== undefined
    return (
        <TooltipDisabledReason reason={disabledReason ?? undefined} side="top" className="rounded-full">
            <button
                type="button"
                disabled={disabled || !!disabledReason}
                className={cn(
                    'relative flex h-(--chrome-control) shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground disabled:pointer-events-none disabled:opacity-50',
                    labelled ? 'px-3' : 'w-(--chrome-control)',
                    className
                )}
                {...props}
            >
                {Icon && <Icon className="size-4 shrink-0" />}
                {label}
                {children}
            </button>
        </TooltipDisabledReason>
    )
}

export function ChromeDivider({ orientation = 'vertical', className }: { orientation?: 'horizontal' | 'vertical'; className?: string }) {
    return <div aria-hidden className={cn('shrink-0 bg-border', orientation === 'vertical' ? 'h-4 w-px' : 'h-px w-4', className)} />
}
