import { Skeleton } from '@/components/ui/skeleton'

export function TemplateDetailPanelSkeleton() {
    return (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-hidden">
                <Skeleton className="aspect-video shrink-0 rounded-none" />

                <div className="flex flex-col gap-5 p-5">
                    <div className="space-y-1.5">
                        <Skeleton className="h-5 w-3/5" />
                        <Skeleton className="h-3.5 w-4/5" />
                    </div>

                    <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 bg-muted/30 p-3">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div key={i} className="flex items-center justify-between gap-4">
                                <Skeleton className="h-3 w-20" />
                                <Skeleton className="h-3 w-12" />
                            </div>
                        ))}
                    </div>

                    <div className="space-y-2">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-3.5 w-full" />
                        <Skeleton className="h-3.5 w-full" />
                        <Skeleton className="h-3.5 w-2/3" />
                    </div>
                </div>
            </div>

            <div className="border-t bg-muted/50 px-5 py-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <Skeleton className="h-9 w-full" />
            </div>
        </div>
    )
}
