'use client'

import { SourceGroup } from '@/components/connections/AiProvidersPanel'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { ForemanAccent } from '@/components/onboarding/panels/ForemanAccent'
import { PanelStage, PanelWindow } from '@/components/onboarding/panels/PanelStage'
import { keyProviders, planProviders, type RerunCredit } from '@/lib/engine/ai-sources'
import type { BoxConnection } from '@/lib/engine/types'
import { Settings2Icon } from '@/lib/icons'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

const RESETS_IN_MS = 3 * 60 * 60 * 1000
const NO_CREDIT: RerunCredit = { usedMicros: 0, budgetMicros: 0, resetAt: null, percent: 0 }
const noop = () => {}

function planConnections(now: number): BoxConnection[] {
    const capturedAt = new Date(now).toISOString()
    const resetsAt = new Date(now + RESETS_IN_MS).toISOString()
    const shared = { models: [], extraModels: [], createdAt: capturedAt, connected: true, credentialRejected: false, cliModels: null, providerModels: null, discoveredModels: null }
    return [
        {
            ...shared,
            id: 'claude',
            name: 'Claude Ultra',
            provider: 'claude',
            planLimits: {
                capturedAt,
                windows: [
                    { kind: 'session', label: null, usedPercent: 18, resetsAt },
                    { kind: 'weekly', label: null, usedPercent: 37, resetsAt },
                ],
            },
        },
        { ...shared, id: 'codex', name: 'ChatGPT Pro', provider: 'codex', planLimits: { capturedAt, windows: [{ kind: 'weekly', label: null, usedPercent: 12, resetsAt }] } },
    ]
}

// The AI providers dialog, as a workspace with two plans plugged in sees it. Its header takes its
// title from the dialog's context: a closed root gives it one without opening anything.
export function ConnectSlide() {
    const tDialog = useTranslations('dialogs.aiProviders')
    const t = useTranslations('connections.panel')
    const [plans] = useState(() => planConnections(Date.now()))
    return (
        <PanelStage width={620} height={505} maxScale={0.86} accent={<ForemanAccent facing="left" className="right-10" />}>
            <DialogPrimitive.Root open={false}>
                <PanelWindow>
                    <DialogHeaderBar icon={Settings2Icon} title={tDialog('title')} description={tDialog('description')} />
                    <div className="space-y-6 p-4">
                        <SourceGroup title={t('groups.plans')} only="plan" sources={plans} credit={NO_CREDIT} taken={new Set(['claude', 'codex'])} onOpen={noop} onAdd={noop} pitch="" providers={planProviders(true)} />
                        <SourceGroup title={t('groups.keys')} only="key" sources={[]} credit={NO_CREDIT} taken={new Set()} onOpen={noop} onAdd={noop} pitch={t('pitch.keysWithCustom')} providers={keyProviders(true)} />
                    </div>
                </PanelWindow>
            </DialogPrimitive.Root>
        </PanelStage>
    )
}
