'use client'

import { RerunOnly } from '@/components/brand/RerunOnly'
import { useResolvedIsMobile } from '@rerun/ui/primitives/use-is-mobile'
import { MotionConfig } from 'motion/react'
import dynamic from 'next/dynamic'
import type { CSSProperties, ReactNode } from 'react'

// Tailwind's `lg`: under it the panel is not only hidden, nothing of it is loaded.
const BESIDE_QUERY = '(min-width: 1024px)'

const PanelGround = dynamic(() => import('./PanelGround').then(module => module.PanelGround), { ssr: false })

// The ground is dark in both themes, so what stands on it is drawn in the dark theme. An
// organization's clients sign in on the form alone: the panel is Rerun talking about itself.
export function OnboardingPanel({ children }: { children?: ReactNode }) {
    const beside = useResolvedIsMobile(BESIDE_QUERY)
    return (
        <RerunOnly>
            <div className="hidden w-1/2 shrink-0 p-3 ps-0 lg:block">
                <section
                    className="dark relative isolate flex h-full flex-col overflow-hidden rounded-2xl bg-(--panel-ground) text-foreground ring-1 ring-border [--muted-foreground:rgb(255_255_255/0.68)]"
                    style={{ '--panel-ground': '#0c0a1f' } as CSSProperties}
                >
                    {beside && (
                        <MotionConfig reducedMotion="user">
                            <PanelGround />
                            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-linear-to-t from-(--panel-ground) from-20% to-transparent" />
                            {children}
                        </MotionConfig>
                    )}
                </section>
            </div>
        </RerunOnly>
    )
}

// What every panel ends on: a large title and the line under it.
export function PanelCaption({ title, line }: { title: ReactNode; line: ReactNode }) {
    return (
        <div className="space-y-2">
            <h2 className="text-3xl font-medium tracking-tight text-balance xl:text-4xl">{title}</h2>
            <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{line}</p>
        </div>
    )
}
