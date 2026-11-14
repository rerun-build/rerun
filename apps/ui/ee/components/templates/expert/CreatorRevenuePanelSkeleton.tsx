import { Skeleton } from '@/components/ui/skeleton'

const ROW_WIDTHS = ['w-28', 'w-36', 'w-24', 'w-32', 'w-28', 'w-40']

export function CreatorRevenuePanelSkeleton() {
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-5 p-5">
            <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-40 rounded-md" />
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ROW_WIDTHS.slice(0, 4).map(width => (
                    <div key={width} className="space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-6 w-20" />
                    </div>
                ))}
            </div>

            <Skeleton className="h-48 w-full rounded-lg" />

            <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                {ROW_WIDTHS.map(width => (
                    <div key={width} className="flex items-center justify-between gap-4 py-2">
                        <Skeleton className="h-3 w-12" />
                        <Skeleton className={`h-3 ${width}`} />
                        <Skeleton className="h-4 w-16 rounded-full" />
                        <Skeleton className="h-3 w-12" />
                    </div>
                ))}
            </div>
        </div>
    )
}
