'use client'

import { useBrand } from '@/components/brand/BrandProvider'
import { cn } from '@/lib/utils'
import { isWhiteLabel, type Brand } from '@rerun/contracts'
import { AnimatedLogo, Logo, logoVariants } from '@rerun/ui/logo'
import type { ComponentProps } from 'react'

type BrandLogoProps = Omit<ComponentProps<typeof Logo>, 'children'>

// The logo of the brand the page is shown under: Rerun's mark, or the icon of the organization.
export function BrandLogo({ size, compact, className, ...rest }: BrandLogoProps) {
    const brand = useBrand()
    if (!isWhiteLabel(brand)) return <Logo size={size} compact={compact} className={className} {...rest} />
    return (
        <span data-slot="logo" className={cn(logoVariants({ size }), className)} {...rest}>
            <BrandIcon brand={brand} />
        </span>
    )
}

function BrandIcon({ brand }: { brand: Brand }) {
    // eslint-disable-next-line @next/next/no-img-element
    if (brand.iconUrl) return <img src={brand.iconUrl} alt="" className="size-full object-cover" />
    return (
        <span aria-hidden className="flex size-full items-center justify-center bg-foreground text-sm font-semibold text-background">
            {brand.name.trim().charAt(0).toUpperCase()}
        </span>
    )
}

// What a screen that is still loading shows in its middle.
export function BrandLoadingLogo() {
    const brand = useBrand()
    if (!isWhiteLabel(brand)) return <AnimatedLogo size="3xl" frame={false} />
    return <BrandLogo size="xl" className="animate-pulse motion-reduce:animate-none" />
}
