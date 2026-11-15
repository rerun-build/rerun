'use client'

import type { ReactNode } from 'react'

import { KitControlsProvider } from './KitControls'
import { KitToc, type KitTocEntry } from './KitToc'
import { KitToolbar } from './KitToolbar'

export function KitPage({
    title,
    description,
    eyebrow,
    toc,
    aside,
    children,
}: {
    title: string
    description?: ReactNode
    eyebrow?: ReactNode
    toc?: KitTocEntry[]
    aside?: ReactNode
    children: ReactNode
}) {
    return (
        <KitControlsProvider>
            <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 md:py-24">
                <header className="flex flex-col gap-6">
                    {eyebrow && <div className="font-mono text-xs text-foreground/40">{eyebrow}</div>}
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="max-w-2xl">
                            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
                            {description && <div className="mt-3 text-sm text-foreground/60">{description}</div>}
                        </div>
                        {aside}
                    </div>
                    <KitToolbar />
                    {toc && <KitToc entries={toc} />}
                </header>
                {children}
            </div>
        </KitControlsProvider>
    )
}
