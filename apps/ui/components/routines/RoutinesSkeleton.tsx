import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const SKELETON_GROUPS = [
    { heading: 'w-14', rows: 2 },
    { heading: 'w-20', rows: 3 },
]
const TITLE_WIDTHS = ['w-1/2', 'w-2/5', 'w-3/5', 'w-1/3', 'w-1/2']
const RULE_WIDTHS = ['w-3/5', 'w-1/2', 'w-2/3', 'w-2/5', 'w-1/2']

// The shape of `RoutineList` while it loads; `withAgent` keeps the coworker's face at the start of each row.
export function RoutinesSkeleton({ withAgent = true, className }: { withAgent?: boolean; className?: string }) {
    let rowIndex = 0
    return (
        <div className={cn('flex flex-col', className)}>
            <div className="min-h-0 flex-1 overflow-hidden px-3 pb-4">
                {SKELETON_GROUPS.map((group, groupIndex) => (
                    <section key={groupIndex}>
                        <div className={cn('-mx-3 flex items-center px-4 pb-2.5', groupIndex === 0 ? 'pt-2' : 'pt-7')}>
                            <div className="flex h-6 items-center gap-2">
                                <Skeleton className={cn('h-4', group.heading)} />
                                <Skeleton className="h-3.5 w-3" />
                            </div>
                        </div>
                        <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border bg-muted/20">
                            {Array.from({ length: group.rows }).map(() => {
                                const i = rowIndex++
                                return (
                                    <div key={i} className="flex min-h-16 items-center gap-3 px-4 py-3">
                                        {withAgent && <Skeleton className="size-7 shrink-0 rounded-md" />}
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <div className="flex h-5 items-center">
                                                <Skeleton className={cn('h-3.5', TITLE_WIDTHS[i % TITLE_WIDTHS.length])} />
                                            </div>
                                            <div className="flex h-4 items-center">
                                                <Skeleton className={cn('h-3', RULE_WIDTHS[i % RULE_WIDTHS.length])} />
                                            </div>
                                        </div>
                                        <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
                                        <Skeleton className="size-7 shrink-0 rounded-md" />
                                    </div>
                                )
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    )
}
