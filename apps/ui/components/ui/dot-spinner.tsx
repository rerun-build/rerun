'use client'

import { DotLoader, dotSpinnerFrames } from '@moldwright/ui/primitives'
import { cn } from '@/lib/utils'

const variantStyles = {
    dark: 'bg-white opacity-0 [&.active]:opacity-100',
    light: 'bg-primary opacity-0 [&.active]:opacity-100',
}

const sizeStyles = {
    xs: 'size-0.5',
    sm: 'size-[3px]',
    md: 'size-1',
}

export type DotSpinnerProps = {
    variant?: 'dark' | 'light'
    size?: 'xs' | 'sm' | 'md'
    duration?: number
    className?: string
}

export const DotSpinner = ({ variant = 'dark', size = 'sm', duration = 90, className }: DotSpinnerProps) => {
    return <DotLoader frames={dotSpinnerFrames} cols={3} count={9} duration={duration} className={cn('gap-[3px]', className)} dotClassName={cn('rounded-full transition-opacity duration-300 ease-out', sizeStyles[size], variantStyles[variant])} />
}
