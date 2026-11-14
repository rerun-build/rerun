import { BorderBeam, type BorderBeamProps } from '../BorderBeam'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { buttonVariants, type ButtonVariantProps } from './button-variants'
import { DotLoader, dotSpinnerFrames } from './dot-loader'
import { cn } from '../cn'

function Button({
    className,
    variant = 'default',
    size = 'default',
    asChild = false,
    loading = false,
    highlight = false,
    disabled,
    children,
    ...props
}: React.ComponentProps<'button'> &
    ButtonVariantProps & {
        asChild?: boolean
        loading?: boolean
        highlight?: boolean | Partial<BorderBeamProps>
    }) {
    const Comp = asChild ? Slot.Root : 'button'

    const beamProps: BorderBeamProps | null = highlight ? { tone: 'white', pattern: 'arcs', animated: true, glow: true, outset: 1, ...(highlight === true ? {} : highlight) } : null

    if (asChild) {
        return (
            <Comp data-slot="button" data-variant={variant} data-size={size} disabled={disabled || loading} className={cn(buttonVariants({ variant, size, className }), beamProps && 'relative')} {...props}>
                {beamProps ? (
                    <>
                        <BorderBeam {...beamProps} />
                        <Slot.Slottable>{children}</Slot.Slottable>
                    </>
                ) : (
                    children
                )}
            </Comp>
        )
    }

    return (
        <Comp data-slot="button" data-variant={variant} data-size={size} disabled={disabled || loading} className={cn(buttonVariants({ variant, size, className }), beamProps && 'relative')} {...props}>
            {beamProps && <BorderBeam {...beamProps} />}
            {loading ? <DotLoader frames={dotSpinnerFrames} cols={3} count={9} duration={90} dotClassName="size-[3px] rounded-full bg-current opacity-0 transition-opacity duration-300 ease-out [&.active]:opacity-100" /> : children}
        </Comp>
    )
}

export { Button, buttonVariants }
