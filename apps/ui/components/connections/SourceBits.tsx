'use client'

import { Button } from '@/components/ui/button'
import { EditableName } from '@/components/ui/editable-name'
import { Progress } from '@/components/ui/progress'
import { connectMethod, providerPitch, sourceKind, isCreditExhausted, isRerunPaused, planLimitTone, type AddableProvider, type RerunCredit } from '@/lib/engine/ai-sources'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import type { BoxConnection } from '@/lib/engine/types'
import { ChevronLeftIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { RERUN_CONNECTION_ID, addableProviderSchema } from '@rerun/contracts'
import { useBrand } from '@/components/brand/BrandProvider'
import { Badge } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'

export function SourceStatus({ source, credit }: { source: BoxConnection; credit: RerunCredit }) {
    const t = useTranslations('connections.status')
    if (isRerunPaused(source, credit)) {
        return (
            <Badge size="xs" tone="orange" className="shrink-0">
                {t('paused')}
            </Badge>
        )
    }
    if (isCreditExhausted(source, credit)) {
        return (
            <Badge size="xs" tone="red" className="shrink-0">
                {t('creditsUsedUp')}
            </Badge>
        )
    }
    if (!source.connected || source.credentialRejected) {
        const signsIn = connectMethod(source.provider) !== 'key'
        return (
            <Badge size="xs" tone="orange" className="shrink-0">
                {signsIn ? t('signInAgain') : source.connected ? t('keyRejected') : t('keyMissing')}
            </Badge>
        )
    }
    return (
        <Badge size="xs" tone="green" className="shrink-0">
            {t('ready')}
        </Badge>
    )
}

export function SourceAvatar({ provider, size = 'md' }: { provider: string; size?: 'sm' | 'md' }) {
    return (
        <span className={cn('flex shrink-0 items-center justify-center rounded-md border bg-background', size === 'sm' ? 'size-7' : 'size-9')}>
            <ProviderIcon provider={provider} className={size === 'sm' ? 'size-3.5' : 'size-4.5'} />
        </span>
    )
}

export function CreditMeter({ percent, className }: { percent: number; className?: string }) {
    const t = useTranslations('connections.meter')
    return <Progress value={percent} size="md" tone={percent >= 100 ? 'destructive' : 'brand'} label={t('monthlyCredits')} className={className} />
}

export function PlanLimitMeter({ percent, label, className }: { percent: number; label: string; className?: string }) {
    return <Progress value={percent} size="md" tone={planLimitTone(percent)} label={label} className={className} />
}

function BackButton({ onBack }: { onBack: () => void }) {
    const t = useTranslations('connections')
    return (
        <Button aria-label={t('backToProviders')} variant="ghost" size="icon-sm" className="shrink-0" onClick={onBack}>
            <ChevronLeftIcon className="size-4" />
        </Button>
    )
}

function SourceSubtitle({ source, credit }: { source: BoxConnection; credit: RerunCredit }) {
    const t = useTranslations('connections.subtitle')
    const tManaged = useTranslations('managed.credit')
    const { name: brandName } = useBrand()
    const tConnections = useTranslations('connections')
    if (source.id === RERUN_CONNECTION_ID) return credit.managed ? tManaged('providedBy', { manager: brandName }) : t('included')
    const provider = addableProviderSchema.safeParse(source.provider)
    if (!provider.success) return source.provider
    const pitch = providerPitch(provider.data, tConnections)
    return sourceKind(source.provider) === 'plan' || source.provider === 'custom' ? pitch.title : t('apiKey', { provider: pitch.title })
}

export function DetailHeader({ source, credit, onBack, onRename }: { source: BoxConnection; credit: RerunCredit; onBack: () => void; onRename?: (name: string) => void }) {
    return (
        <div className="flex items-center gap-3 border-b px-3 py-2.5">
            <BackButton onBack={onBack} />
            <SourceAvatar provider={source.provider} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col">
                {source.id === RERUN_CONNECTION_ID || !onRename ? <span className="truncate text-sm font-medium">{source.name}</span> : <EditableName name={source.name} onRename={onRename} />}
                <span className="truncate text-[11px] text-muted-foreground"><SourceSubtitle source={source} credit={credit} /></span>
            </div>
            <SourceStatus source={source} credit={credit} />
        </div>
    )
}

export function ProviderHeader({ provider, onBack }: { provider: AddableProvider; onBack: () => void }) {
    const t = useTranslations('connections')
    const pitch = providerPitch(provider, t)
    return (
        <div className="flex items-center gap-3 border-b px-3 py-2.5">
            <BackButton onBack={onBack} />
            <SourceAvatar provider={provider} size="sm" />
            <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{pitch.title}</span>
                <span className="truncate text-[11px] text-muted-foreground">{pitch.hint}</span>
            </div>
        </div>
    )
}
