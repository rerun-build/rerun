import { cn } from '../cn'

export type StepperSplit = { index: number; count: number; current: number }

export type StepperGroup = { label: string; count: number }

const GAP_PX = 6

export function StepperBar({ count, current, className, split, groups }: { count: number; current: number; className?: string; split?: StepperSplit; groups?: readonly StepperGroup[] }) {
    if (!groups?.length) {
        return (
            <div className={cn('flex gap-1.5', className)}>
                {Array.from({ length: count }, (_, i) => (
                    <Step key={i} index={i} current={current} split={split} />
                ))}
            </div>
        )
    }

    let offset = 0

    return (
        <div className={cn('flex gap-1.5', className)}>
            {groups.map(group => {
                const start = offset
                offset += group.count
                return (
                    <div
                        key={group.label}
                        className="flex min-w-0 flex-col gap-2.5"
                        style={{ flexGrow: group.count, flexBasis: `${(group.count - 1) * GAP_PX}px` }}
                    >
                        <span className={cn('truncate text-xs font-medium transition-colors', current >= start && current < start + group.count ? 'text-foreground' : 'text-muted-foreground')}>{group.label}</span>
                        <div className="flex gap-1.5">
                            {Array.from({ length: group.count }, (_, i) => (
                                <Step key={i} index={start + i} current={current} split={split} />
                            ))}
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

function Step({ index, current, split }: { index: number; current: number; split?: StepperSplit }) {
    if (split?.index !== index) return <Segment filled={index <= current} current={index === current} />

    return (
        <div className="flex flex-1 gap-1.5">
            {Array.from({ length: split.count }, (_, j) => (
                <Segment key={j} filled={index < current || (index === current && j <= split.current)} current={index === current && j === split.current} />
            ))}
        </div>
    )
}

function Segment({ filled, current }: { filled: boolean; current: boolean }) {
    return <div className={cn('h-1 flex-1 rounded-full transition-colors', filled ? 'bg-foreground' : 'bg-foreground/15', current && 'stepper-stripes')} />
}
