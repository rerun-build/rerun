import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '../cn'

export const R_PATH =
    'M69.39,399.06Q55.56,391.02 55.51,375.02L54.84,134.50Q54.80,118.50 68.63,126.54L248.94,231.34Q262.78,239.38 262.82,255.38L263.51,495.88Q263.56,511.88 249.72,503.84Z M224.25,8.00Q238.11,0.00 251.94,8.04L432.37,112.89Q446.21,120.92 432.35,128.92L287.50,212.55Q273.64,220.55 259.81,212.51L79.39,107.67Q65.56,99.63 79.41,91.63Z M442.44,147.35Q456.52,139.75 456.56,155.75L456.61,173.16Q456.65,189.16 442.80,197.16L378.85,234.08Q365.00,242.08 365.04,258.08L365.55,443.00Q365.60,459.00 351.74,467.00L304.03,494.56Q290.18,502.56 290.13,486.56L289.45,245.93Q289.40,229.93 303.48,222.33Z'

const logoVariants = cva(
    'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/5 text-foreground',
    {
        variants: {
            size: {
                sm: 'size-8',
                md: 'size-10',
                lg: 'size-12',
                xl: 'size-16',
            },
        },
        defaultVariants: { size: 'md' },
    },
)

type LogoProps = React.ComponentProps<'span'> & VariantProps<typeof logoVariants>

const SHIMMER_BRIGHT = 'var(--logo-shimmer-bright)'
const SHIMMER_DIM = 'var(--logo-shimmer-dim)'

export function Logo({ size = 'md', className, ...rest }: LogoProps) {
    const id = React.useId() // id de pattern SSR-safe par instance
    return (
        <span data-slot="logo" className={cn(logoVariants({ size }), className)} {...rest}>
            <svg
                aria-hidden
                className="pointer-events-none absolute inset-0 size-full text-foreground"
                style={{
                    opacity: 'var(--logo-grid-opacity)',
                    maskImage: 'radial-gradient(circle at 50% 50%, black 0%, transparent 90%)',
                    WebkitMaskImage: 'radial-gradient(circle at 50% 50%, black 0%, transparent 90%)',
                }}
            >
                <defs>
                    <pattern id={id} x="12.5%" y="12.5%" width="25%" height="25%" patternUnits="userSpaceOnUse">
                        <path d="M 512 0 L 0 0 L 0 512" fill="none" stroke="currentColor" strokeWidth={0.5} />
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

            <span
                aria-hidden
                className="pointer-events-none absolute inset-0 z-20 rounded-[inherit]"
                style={{
                    padding: 1,
                    background: `conic-gradient(from 279deg, ${SHIMMER_DIM} 0%, ${SHIMMER_BRIGHT} 10%, ${SHIMMER_DIM} 22%, ${SHIMMER_DIM} 50%, ${SHIMMER_BRIGHT} 60%, ${SHIMMER_DIM} 72%, ${SHIMMER_DIM} 100%)`,
                    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
                    WebkitMaskComposite: 'xor',
                    maskComposite: 'exclude',
                }}
            />

            <svg viewBox="0 0 512 512" fill="currentColor" aria-hidden className="relative z-10 h-1/2 w-1/2">
                <path fillRule="evenodd" d={R_PATH} />
            </svg>
        </span>
    )
}
