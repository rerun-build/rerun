'use client'

import { Button } from '@/components/ui/button'
import { ArrowRightIcon } from '@/lib/icons'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { CoinStack, type CatalogEntry } from '@rerun/ui/new-agent'
import { Spinner } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { type ReactNode, useState } from 'react'

function setupMinutes(apps: CatalogEntry[]): number {
    return Math.max(2, 1 + apps.length)
}

export function InstallGate({
    agentId,
    agentName,
    apps,
    onStart,
    onSkip,
    onContinue,
    inProgress = false,
    disabled = false,
    modelSlot,
    hint,
}: {
    agentId: string
    agentName: string
    apps: CatalogEntry[]
    onStart: () => boolean
    onSkip: () => void
    onContinue?: () => void
    inProgress?: boolean
    disabled?: boolean
    modelSlot?: ReactNode
    hint?: ReactNode
}) {
    const t = useTranslations('chat.installGate')
    const [launched, setLaunched] = useState(false)
    const starting = launched || disabled

    const start = () => {
        if (onStart()) setLaunched(true)
    }

    return (
        <div className="space-y-3 [--cut:var(--color-background)]">
            <div className="flex items-center gap-3">
                <AgentBuddy agentId={agentId} mood={inProgress ? 'idle' : starting ? 'working' : 'waiting'} size={40} facing="right" alive />
                <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{inProgress ? t('inProgressTitle', { name: agentName }) : t('title', { name: agentName })}</p>
                    <p className="text-xs text-pretty text-muted-foreground">{inProgress ? t('inProgressHint') : t('facts', { apps: apps.length, minutes: setupMinutes(apps) })}</p>
                </div>
                {apps.length > 0 && <CoinStack apps={apps} size={24} overlap={7} className="shrink-0" />}
            </div>
            {hint}
            {inProgress ? (
                <Button size="lg" disabled={disabled} onClick={onContinue} className="w-full">
                    {t('continue')}
                    <ArrowRightIcon data-icon="inline-end" />
                </Button>
            ) : (
                <Button size="lg" disabled={starting} onClick={start} className="w-full">
                    {starting && <Spinner data-icon="inline-start" />}
                    <span className="truncate">{starting ? t('installing') : t('install', { name: agentName })}</span>
                    {!starting && <ArrowRightIcon data-icon="inline-end" />}
                </Button>
            )}
            <div className="flex flex-wrap items-center justify-between gap-1">
                {modelSlot}
                <Button size="sm" variant="ghost" disabled={starting} onClick={onSkip} className="ml-auto text-muted-foreground">
                    {t('skip')}
                </Button>
            </div>
        </div>
    )
}
