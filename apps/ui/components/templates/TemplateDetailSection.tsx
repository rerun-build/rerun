import type { ReactNode } from 'react'

export function TemplateDetailSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {title}
                {count !== undefined && <span className="text-muted-foreground/60"> · {count}</span>}
            </p>
            {children}
        </div>
    )
}
