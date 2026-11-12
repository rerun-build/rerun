import { Logo } from '@rerun/ui/logo'
import type { ReactNode } from 'react'

// The frame of the shell's full-window pages: a strip to drag the window by where the web app would
// draw its own, and a centered column under it.
export function ShellFrame({ children }: { children: ReactNode }) {
    return (
        <div className="flex h-full flex-col bg-background">
            <div className="shell-drag h-7 shrink-0 [html[data-platform=win]_&]:h-8 [html[data-platform=linux]_&]:h-8" />
            <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 pb-10">
                <div className="flex w-full max-w-sm flex-col items-center gap-6 text-center">
                    <Logo size="lg" />
                    {children}
                </div>
            </main>
        </div>
    )
}
