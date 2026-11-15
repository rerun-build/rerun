'use client'

import { Icon } from '@/components/ui/icon'
import type { TemplateStep } from '@/lib/templates/useTemplateCta'
import { Stripes } from '@rerun/ui/primitives'

export function TemplateInstallSteps({ steps }: { steps: TemplateStep[] }) {
    if (steps.length < 2) return null

    return (
        <ol className="mb-3 grid gap-2 sm:grid-cols-2">
            {steps.map(step => (
                <li
                    key={step.label}
                    className="relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 overflow-hidden rounded-lg border border-border bg-card p-2.5 sm:flex sm:flex-col sm:items-start sm:gap-1.5 sm:p-3"
                >
                    <Stripes />
                    <Icon icon={step.icon} size="sm" className="row-span-2" />
                    <p className="relative text-sm font-medium leading-tight text-foreground">{step.label}</p>
                    <p className="relative col-start-2 text-xs leading-snug text-muted-foreground">{step.caption}</p>
                </li>
            ))}
        </ol>
    )
}
