import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../cn'
import { BuddyArt } from './buddy/art'
import { BRAND_BUDDY, COMPACT_BRAND_BUDDY } from './buddy/config'

// The Buddy in one colour, in a 512 box: the round body, the visor cut out of it, the happy eyes inside.
// For what can only draw a single filled shape (a macOS template image, confetti, a CSS mask).
export const MARK_PATH =
    'M20 270A236 236 0 1 0 492 270A236 236 0 1 0 20 270ZM199 162.4H313A61.9 60.7 0 0 1 313 283.8H199A61.9 60.7 0 0 1 199 162.4ZM179.3 230.7Q208.9 187.9 238.5 230.7A8.7 8.7 0 0 1 223.9 239.8Q208.9 214.6 193.9 239.8A8.7 8.7 0 0 1 179.3 230.7ZM273.5 230.7Q303.1 187.9 332.7 230.7A8.7 8.7 0 0 1 318.1 239.8Q303.1 214.6 288.1 239.8A8.7 8.7 0 0 1 273.5 230.7Z'

export const logoVariants = cva('relative inline-flex shrink-0 overflow-hidden rounded-[22.37%] [&>svg]:size-full', {
    variants: {
        size: {
            sm: 'size-8',
            md: 'size-10',
            lg: 'size-12',
            xl: 'size-16',
        },
    },
    defaultVariants: { size: 'md' },
})

type LogoProps = React.ComponentProps<'span'> &
    VariantProps<typeof logoVariants> & {
        /** Drawn 16 px wide or less: a flat Buddy, without the fur filters it would not show. */
        compact?: boolean
    }

// Rerun's mark: the app icon, the Buddy rising in its rounded square. A class with a size (size-4) draws it at any size.
export function Logo({ size = 'md', compact = false, className, ...rest }: LogoProps) {
    return (
        <span data-slot="logo" className={cn(logoVariants({ size }), className)} {...rest}>
            <BuddyArt config={compact ? COMPACT_BRAND_BUDDY : BRAND_BUDDY} />
        </span>
    )
}
