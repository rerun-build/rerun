import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { brandIconFilter } from '../brand-icon'
import { BorderBeam, type BorderBeamProps } from '../BorderBeam'
import { cn } from '../cn'

const iconVariants = cva(
    'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/5 text-foreground',
    {
        variants: {
            size: {
                xs: "size-5 rounded-md [&_svg:not([class*='size-'])]:size-2.5",
                sm: "size-8 [&_svg:not([class*='size-'])]:size-3.5",
                md: "size-10 [&_svg:not([class*='size-'])]:size-[1.125rem]",
                lg: "size-12 [&_svg:not([class*='size-'])]:size-[1.375rem]",
                xl: "size-16 [&_svg:not([class*='size-'])]:size-[1.875rem]",
                fill: "size-full rounded-none bg-transparent [&_svg:not([class*='size-'])]:size-[38%]",
            },
        },
        defaultVariants: { size: 'md' },
    },
)

const CELL: Record<NonNullable<VariantProps<typeof iconVariants>['size']>, number> = {
    xs: 5,
    sm: 8,
    md: 10,
    lg: 12,
    xl: 16,
    fill: 12,
}

function beamAngleFrom(id: string) {
    let hash = 0
    for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0
    return Math.abs(hash) % 360
}

const GLYPH_SIZE: Record<NonNullable<VariantProps<typeof iconVariants>['size']>, string> = {
    xs: 'size-2.5',
    sm: 'size-3.5',
    md: 'size-[1.125rem]',
    lg: 'size-[1.375rem]',
    xl: 'size-[1.875rem]',
    fill: 'size-[38%]',
}

type IconGlyph = { icon: React.ComponentType<{ className?: string }>; src?: never } | { src: string; icon?: never }

type IconProps = React.ComponentProps<'span'> &
    VariantProps<typeof iconVariants> &
    IconGlyph & {
        tone?: BorderBeamProps['tone']
        loading?: 'eager' | 'lazy'
        glyphClassName?: string
    }

function Icon({ size = 'md', tone = 'neutral', className, glyphClassName, loading, ...props }: IconProps) {
    const { icon: Glyph, src, ...rest } = props as { icon?: React.ComponentType<{ className?: string }>; src?: string } & React.ComponentProps<'span'>
    const id = React.useId() // id de pattern SSR-safe par instance
    const c = CELL[size ?? 'md']
    return (
        <span data-slot="icon" data-size={size} className={cn(iconVariants({ size }), className)} {...rest}>
            {size !== 'fill' && <BorderBeam tone={tone} animated={false} angle={beamAngleFrom(id)} />}
            <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 size-full text-foreground"
                style={{
                    opacity: 'var(--icon-grid-opacity)',
                    maskImage: 'radial-gradient(circle at 50% 50%, black 0%, transparent 78%)',
                    WebkitMaskImage: 'radial-gradient(circle at 50% 50%, black 0%, transparent 78%)',
                }}
            >
                <defs>
                    <pattern id={id} width={c} height={c} patternUnits="userSpaceOnUse">
                        <path d={`M ${c} 0 L 0 0 L 0 ${c}`} fill="none" stroke="currentColor" strokeWidth={0.5} />
                    </pattern>
                </defs>
                <rect width="100%" height="100%" fill={`url(#${id})`} />
            </svg>
            <span
                aria-hidden
                className="pointer-events-none absolute inset-0"
                style={{
                    background:
                        'radial-gradient(circle at 50% 50%, rgb(var(--icon-glint) / var(--icon-glint-core)), rgb(var(--icon-glint) / var(--icon-glint-halo)) 45%, transparent 70%)',
                }}
            />
            {src ? (
                <img
                    src={src}
                    alt=""
                    aria-hidden
                    loading={loading}
                    decoding={loading === 'lazy' ? 'async' : undefined}
                    className={cn('relative z-10 object-contain', GLYPH_SIZE[size ?? 'md'], glyphClassName)}
                    style={{ filter: brandIconFilter(src) }}
                />
            ) : (
                Glyph && <Glyph className={cn('relative z-10', glyphClassName)} />
            )}
        </span>
    )
}

export { Icon, iconVariants }
