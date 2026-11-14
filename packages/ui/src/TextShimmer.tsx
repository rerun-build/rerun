import type { CSSProperties, ElementType, FC, ReactNode } from 'react'
import { cn } from './cn'

type ShimmerTagProps = { className?: string; style?: CSSProperties; children?: ReactNode }

export interface TextShimmerProps {
    children: string
    as?: ElementType
    className?: string
    duration?: number
    delay?: number
    spread?: number
    scaleSpreadWithLength?: boolean
}

export function TextShimmer({
    children,
    as: Component = 'span',
    className,
    duration = 2,
    delay = 0,
    spread = 16,
    scaleSpreadWithLength = false,
}: TextShimmerProps) {
    const Tag = Component as FC<ShimmerTagProps>
    const effectiveSpread = scaleSpreadWithLength
        ? (children?.length ?? 0) * spread
        : spread

    return (
        <Tag
            className={cn(
                'relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent [background-repeat:no-repeat,padding-box]',
                '[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--shimmer-highlight),#0000_calc(50%+var(--spread)))]',
                '[--shimmer-base:var(--muted-foreground)] [--shimmer-highlight:var(--foreground)]',
                className,
            )}
            style={
                {
                    '--spread': `${effectiveSpread}px`,
                    backgroundImage:
                        'var(--bg), linear-gradient(var(--shimmer-base), var(--shimmer-base))',
                    animation: `text-shimmer ${duration}s linear ${delay}s infinite`,
                } as CSSProperties
            }
        >
            {children}
        </Tag>
    )
}
