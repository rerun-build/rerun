import type { ReactNode } from 'react'
import { PanelCaption } from './OnboardingPanel'

// A panel's picture over its caption.
export function PanelPage({ title, line, children }: { title: ReactNode; line: ReactNode; children: ReactNode }) {
    return (
        <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 px-8 pt-8 pb-6">{children}</div>
            <div className="shrink-0 px-8 pb-10">
                <PanelCaption title={title} line={line} />
            </div>
        </div>
    )
}
