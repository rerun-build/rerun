import { Skeleton } from '@/components/ui/skeleton'

export function CreatorPayoutsPanelSkeleton() {
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 p-5">
            <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-56" />
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-64" />
                    </div>
                    <Skeleton className="h-4 w-16 rounded-full" />
                </div>
                <Skeleton className="h-8 w-32 rounded-md" />
            </div>

            <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-muted/30 p-3">
                {['w-20', 'w-28', 'w-24'].map(width => (
                    <div key={width} className="flex items-center justify-between gap-4">
                        <Skeleton className={`h-3 ${width}`} />
                        <Skeleton className="h-3 w-16" />
                    </div>
                ))}
            </div>
        </div>
    )
}
