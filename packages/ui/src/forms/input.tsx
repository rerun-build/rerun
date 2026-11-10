'use client'

import * as React from 'react'

import { cn } from '../cn'
import { EyeIcon, EyeOffIcon } from '../icons'
import { Field } from './field'
import { useKitTranslations } from '../locale'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string
    optional?: boolean
    children?: React.ReactNode
    helperText?: string
    hideRequired?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, children, label, helperText, hideRequired, optional, ...props }, ref) => {
    const t = useKitTranslations()
    const [showPassword, setShowPassword] = React.useState(false)
    const isPassword = type === 'password'
    const resolvedType = isPassword && showPassword ? 'text' : type

    const inputEl = (
        <input
            type={resolvedType}
            className={cn(
                'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-base md:text-sm outline-none ring-0 transition-all file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-red-500 aria-invalid:shadow-red-500/30 aria-invalid:focus:border-red-500 aria-invalid:focus:ring-red-500',
                isPassword && 'pr-10',
                className,
            )}
            ref={ref}
            {...props}
        />
    )

    const control =
        children ??
        (isPassword ? (
            <div className="relative">
                {inputEl}
                <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword(show => !show)}
                    aria-label={showPassword ? t('forms.hidePassword') : t('forms.showPassword')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                    {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
            </div>
        ) : (
            inputEl
        ))

    return (
        <Field label={label} optional={optional} hideRequired={hideRequired} helperText={helperText} htmlFor={props.id}>
            {control}
        </Field>
    )
})
Input.displayName = 'Input'

export { Input }
