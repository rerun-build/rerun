import * as React from 'react'

import { cn } from '../cn'
import { OptionalMark } from './optional-mark'

export interface FieldProps {
    label?: string
    /** Rendu juste après le titre, en colonne seulement (un badge, une pastille). */
    labelTrailing?: React.ReactNode
    optional?: boolean
    hideRequired?: boolean
    helperText?: string
    error?: string
    htmlFor?: string
    orientation?: 'column' | 'row'
    className?: string
    children: React.ReactNode
}

function Field({ label, labelTrailing, optional, hideRequired, helperText, error, htmlFor, orientation = 'column', className, children }: FieldProps) {
    const showOptional = optional && !hideRequired
    const hasTitle = label || showOptional

    if (!hasTitle && !helperText && !error) {
        return <>{children}</>
    }

    const Title = htmlFor ? 'label' : 'span'

    if (orientation === 'row') {
        return (
            <div className={cn('flex items-center justify-between gap-4', className)}>
                {hasTitle && (
                    <div className="flex min-w-0 flex-col gap-0.5">
                        <Title htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
                            {label}
                        </Title>
                        {helperText && <span className="text-xs text-muted-foreground/70">{helperText}</span>}
                    </div>
                )}
                {children}
            </div>
        )
    }

    return (
        <div className={cn('flex flex-col gap-1.5', className)}>
            {hasTitle && (
                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                    {labelTrailing ? (
                        <span className="flex items-center gap-1.5">
                            <Title htmlFor={htmlFor}>{label}</Title>
                            {labelTrailing}
                        </span>
                    ) : (
                        <Title htmlFor={htmlFor}>{label}</Title>
                    )}
                    {showOptional && <OptionalMark />}
                </div>
            )}

            {children}

            {error ? (
                <p className="text-xs text-destructive">{error}</p>
            ) : helperText ? (
                <p className="text-xs text-muted-foreground/70">{helperText}</p>
            ) : null}
        </div>
    )
}

export { Field }
