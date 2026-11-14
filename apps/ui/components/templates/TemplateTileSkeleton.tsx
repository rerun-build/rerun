import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function TemplateTileSkeleton({ className }: { className?: string }) {
    return (
        <div aria-hidden className={cn('flex min-w-0 flex-col', className)}>
            <Skeleton className="aspect-[1200/630] w-full rounded-xl" />
            <Skeleton className="mx-0.5 mt-3.5 h-4 w-3/5" />
            <Skeleton className="mx-0.5 mt-2 h-3.5 w-4/5" />
            <div className="mt-3 flex items-center justify-between px-0.5">
                <Skeleton className="h-4 w-24 rounded-full" />
                <Skeleton className="h-3.5 w-12" />
            </div>
        </div>
    )
}
