'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { track } from '@rerun/analytics/client'
import { Button } from '@/components/ui/button'
import { TemplateInstallSteps } from '@/components/templates/TemplateInstallSteps'
import type { LibraryTemplate } from '@/lib/templates/library'
import { useTemplateCta } from '@/lib/templates/useTemplateCta'

// Extracted from TemplateDetailPanel rather than grown inside it: the buy / use decision is a
// hook's worth of rules and the panel was already long enough.
export function TemplateDetailFooter({ template, onImported }: { template: LibraryTemplate; onImported: () => void }) {
    const t = useTranslations('templates.detail')
    const cta = useTemplateCta(template, onImported)
    const recurring = template.pricing.model === 'recurring'

    // Une template qui demande un plan avant de s'installer : cette fiche EST le paywall, il n'y a
    // plus de BillingDialog derrière pour compter la vue.
    const paywallSeen = useRef<string | null>(null)
    const gate = cta.gate
    useEffect(() => {
        if (gate !== 'plan' || paywallSeen.current === template.slug) return
        paywallSeen.current = template.slug
        track('paywall_viewed', { trigger: 'template_install' })
    }, [gate, template.slug])

    return (
        // The sheet's own safe-area padding is dropped by the p-0 the library dialog passes, so the
        // footer that sits against the bottom edge carries it itself.
        <div className="border-t bg-muted/50 px-5 py-4 max-sm:pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <TemplateInstallSteps steps={cta.steps} />
            <Button type="button" className="w-full" loading={cta.pending} disabled={cta.disabled || cta.pending} title={cta.disabledReason ?? undefined} onClick={cta.run}>
                {cta.label}
            </Button>
            {(cta.note || cta.disabledReason) && <p className="mt-2 text-center text-[11px] text-muted-foreground">{cta.disabledReason ?? cta.note}</p>}
            {cta.secondary && (
                <Button type="button" variant="ghost" className="mt-2 w-full" onClick={cta.secondary.run}>
                    {cta.secondary.label}
                </Button>
            )}
            {recurring && template.access !== 'active' && <p className="mt-1 text-center text-[11px] text-muted-foreground">{t('cancelAnytime')}</p>}
        </div>
    )
}
