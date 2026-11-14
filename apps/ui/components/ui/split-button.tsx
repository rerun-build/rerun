'use client'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ChevronDownIcon, type LucideIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'

export type SplitButtonAction = {
    label: string
    icon?: LucideIcon
    destructive?: boolean
    disabled?: boolean
    onSelect: () => void
}

type ButtonProps = React.ComponentProps<typeof Button>
type ButtonSize = NonNullable<ButtonProps['size']>
type ButtonVariant = NonNullable<ButtonProps['variant']>

const TRIGGER_SIZE: Record<ButtonSize, ButtonSize> = {
    xs: 'icon-xs',
    sm: 'icon-sm',
    default: 'icon',
    lg: 'icon-lg',
    icon: 'icon',
    'icon-xs': 'icon-xs',
    'icon-sm': 'icon-sm',
    'icon-lg': 'icon-lg',
}

const SEAM_BY_VARIANT: Partial<Record<ButtonVariant, string>> = {
    default: 'border-l-primary-foreground/25',
    secondary: 'border-l-foreground/15',
    ghost: 'border-l-border',
}

export function SplitButton({
    actions,
    menuAlign = 'end',
    menuLabel,
    variant: variantProp,
    size: sizeProp,
    className,
    disabled,
    ...props
}: ButtonProps & {
    actions: SplitButtonAction[]
    menuAlign?: 'start' | 'end'
    menuLabel?: string
}) {
    const t = useTranslations('ui')
    const variant = variantProp ?? 'default'
    const size = sizeProp ?? 'default'

    return (
        <div data-slot="button-group" className="flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10">
            <Button variant={variant} size={size} disabled={disabled} className={cn('rounded-r-none!', className)} {...props} />
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant={variant} size={TRIGGER_SIZE[size]} disabled={disabled} aria-label={menuLabel ?? t('moreOptions')} className={cn('-ml-px rounded-l-none! border-l', SEAM_BY_VARIANT[variant])}>
                        <ChevronDownIcon className="size-3.5 opacity-60" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align={menuAlign} className="w-auto min-w-40">
                    {actions.map(action => (
                        <DropdownMenuItem key={action.label} variant={action.destructive ? 'destructive' : 'default'} disabled={action.disabled} className="whitespace-nowrap" onSelect={action.onSelect}>
                            {action.icon && <action.icon />}
                            {action.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    )
}
