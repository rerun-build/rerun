import type { ReactNode, Ref } from 'react'

export function FactoryBarFrame({ edge, rightInset, frameRef, className, children }: {
    edge: 'top' | 'bottom'
    rightInset: number
    frameRef?: Ref<HTMLDivElement>
    className?: string
    children: ReactNode
}) {
    return (
        <div
            data-bar-frame={edge}
            className={`pointer-events-none absolute ${edge === 'top' ? 'top-0' : 'bottom-0'} left-0 flex justify-center p-5`}
            style={{ right: rightInset }}
        >
            <div ref={frameRef} className={`pointer-events-auto flex max-w-full flex-wrap items-stretch justify-center gap-x-4 gap-y-3 rounded-2xl border border-border/60 bg-background/75 px-5 py-3 shadow-[0_8px_40px_rgba(0,0,0,0.12)] backdrop-blur-xl${className ? ` ${className}` : ''}`}>
                {children}
            </div>
        </div>
    )
}
