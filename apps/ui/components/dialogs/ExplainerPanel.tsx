'use client'

import { BorderBeam } from '@rerun/ui'
import { CheckIcon } from '@/lib/icons'

export type ExplainerPoint = {
    label: string
    description: string
}

export function ExplainerPanel({ title, points }: { title: string; points: readonly ExplainerPoint[] }) {
    return (
        <div className="hidden flex-col justify-center border-l bg-muted/30 p-8 sm:flex">
            <h3 className="mb-6 text-lg font-medium">{title}</h3>
            <ul className="flex flex-col gap-4">
                {points.map(point => (
                    <li key={point.label} className="flex items-start gap-3">
                        <ExplainerCheck />
                        <div className="min-w-0">
                            <p className="text-sm font-medium">{point.label}</p>
                            <p className="text-sm text-muted-foreground">{point.description}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    )
}

export function ExplainerCheck() {
    return (
        <span
            className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'color-mix(in oklab, var(--foreground) 8%, var(--background))' }}
        >
            <BorderBeam pattern="ring" tone="white" glow animated={false} />
            <CheckIcon className="size-3 text-foreground" />
        </span>
    )
}
