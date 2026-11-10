'use client'

import { Card, CardAction, CardContent, CardHeader, CardTitle, ScrollFade } from '@rerun/ui/primitives'
import { Skeleton } from '@/components/ui/skeleton'

// The placeholder for MyTemplateEditor, built on the same Cards and the same scroll container as the
// sections it stands in for: the geometry comes from the real components rather than from numbers
// copied by hand, so nothing shifts when the document lands.
export function MyTemplateEditorSkeleton() {
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-end gap-1 overflow-hidden border-b border-border px-5">
                {['details', 'pricing', 'media', 'faq', 'agents'].map((tab, index) => (
                    <div key={tab} className="flex h-10 min-w-20 flex-1 items-center justify-center">
                        <Skeleton className={index === 0 ? 'h-3.5 w-12' : 'h-3.5 w-10'} />
                    </div>
                ))}
            </div>

            <ScrollFade className="min-h-0 flex-1 px-5 pb-5">
                <div className="flex flex-col gap-5 pt-5">
                    <SectionCard withAction>
                        <SkeletonField />
                        <div className="grid gap-4 sm:grid-cols-2">
                            <SkeletonField />
                            <SkeletonField />
                        </div>
                        <SkeletonField />
                        <div className="flex flex-col gap-4 border-t border-border pt-4">
                            <SkeletonField />
                            <SkeletonField inputClassName="h-16" />
                        </div>
                    </SectionCard>

                    <SectionCard withAction>
                        <SkeletonField inputClassName="h-16" />
                        <SkeletonField inputClassName="h-40" />
                    </SectionCard>
                </div>
            </ScrollFade>

            <footer className="flex items-center gap-2 border-t border-border px-5 py-4">
                <Skeleton className="size-8" />
                <Skeleton className="ml-auto h-3 w-16" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-36" />
            </footer>
        </div>
    )
}

function SectionCard({ withAction = false, children }: { withAction?: boolean; children: React.ReactNode }) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Skeleton className="h-4 w-24" />
                </CardTitle>
                {withAction && (
                    <CardAction>
                        <Skeleton className="h-7 w-20" />
                    </CardAction>
                )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">{children}</CardContent>
        </Card>
    )
}

function SkeletonField({ inputClassName = 'h-9' }: { inputClassName?: string }) {
    return (
        <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className={inputClassName} />
        </div>
    )
}
