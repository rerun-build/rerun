import { cn } from '../cn'

export function BeamGrid({ id, viewW, viewH, grid = 40, className }: { id: string; viewW: number; viewH: number; grid?: number; className?: string }) {
    return (
        <svg
            viewBox={`0 0 ${viewW} ${viewH}`}
            fill="none"
            aria-hidden
            className={cn('pointer-events-none absolute inset-0 h-full w-full overflow-visible', className)}
            style={{
                maskImage: 'radial-gradient(ellipse at 50% 50%, black 55%, transparent 90%)',
                WebkitMaskImage: 'radial-gradient(ellipse at 50% 50%, black 55%, transparent 90%)',
            }}
        >
            <defs>
                <pattern id={id} x={grid / 2} y={0} width={grid} height={grid} patternUnits="userSpaceOnUse">
                    <path d={`M${grid} 0 H0 V${grid}`} fill="none" className="stroke-neutral-200 dark:stroke-neutral-800" strokeWidth={1} />
                </pattern>
            </defs>
            <rect x={-viewW} y={-viewH} width={viewW * 3} height={viewH * 3} fill={`url(#${id})`} />
        </svg>
    )
}
