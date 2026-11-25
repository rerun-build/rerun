'use client'

import { NewAgentForm } from '@/components/dialogs/new-agent/NewAgentForm'
import { panelCatalog } from '@/components/onboarding/panels/catalog'
import { PanelStage, PanelWindow } from '@/components/onboarding/panels/PanelStage'
import { NOVA } from '@/components/onboarding/panels/cast'
import { AppsPicker, EMPTY_DRAFT, type JobReading } from '@rerun/ui/new-agent'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

const noop = () => {}

// The top of the New coworker dialog with a job typed in it and its apps read out of it, the apps
// picker open under the chip it hangs off. The form keeps the dialog's height, which centers it, and
// the window shows no more of it than the composer.
export function CreateSlide() {
    const t = useTranslations('onboarding.showcase.create')
    const catalog = panelCatalog()
    const [{ draft, reading }] = useState(() => {
        const when = t('when')
        const reading: JobReading = { name: NOVA.name, apps: ['gmail', 'slack', 'notion'], schedule: { label: t('schedule'), source: when } }
        return { draft: { ...EMPTY_DRAFT, text: t('job', { when }) }, reading }
    })
    return (
        <PanelStage width={680} height={620} maxScale={0.78}>
            <div className="h-[348px]">
                <PanelWindow>
                    <div className="flex h-[640px] shrink-0 flex-col">
                        <NewAgentForm suggestions={[]} catalog={catalog} read={async () => reading} onCreate={noop} onBrowseTemplates={noop} still={{ draft, reading }} />
                    </div>
                </PanelWindow>
            </div>
            <div className="absolute start-52 top-[20rem] w-72">
                <PanelWindow className="h-auto">
                    <AppsPicker catalog={catalog} selected={reading.apps} onToggle={noop} />
                </PanelWindow>
            </div>
        </PanelStage>
    )
}
