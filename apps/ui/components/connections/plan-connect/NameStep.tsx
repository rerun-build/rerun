'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTranslations } from 'next-intl'

import type { TrackStep } from './ForemanTrack'
import { StepError } from './step-bits'

type NameStepParams = {
    linked: boolean
    name: string
    placeholder: string
    onName: (name: string) => void
    onDone: () => void
    saving: boolean
    error: string | null
}

// A plain function rather than a hook, so its strings come from small components.
function NameStepText({ part }: { part: 'title' | 'remark' }) {
    const t = useTranslations('connections.nameStep')
    return t(part)
}

function NameStepBody({ linked, name, placeholder, onName, onDone, saving, error }: NameStepParams) {
    const t = useTranslations('connections.nameStep')
    const canFinish = linked && !saving && name.trim() !== ''
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                    <Input hideRequired aria-label={t('fieldLabel')} value={name} onChange={event => onName(event.target.value)} onKeyDown={event => event.key === 'Enter' && canFinish && onDone()} disabled={!linked || saving} placeholder={placeholder} className="h-8 w-full" />
                </div>
                <Button type="button" onClick={onDone} disabled={!canFinish}>
                    {saving ? t('saving') : t('done')}
                </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">{t('helper')}</p>
            <StepError error={error} />
        </div>
    )
}

// The last step of adding a plan: the connection already exists once the token lands (that is when
// the engine says whether the plan is accepted), so the name only renames it before its page opens.
export function nameStep(params: NameStepParams): TrackStep {
    return {
        title: <NameStepText part="title" />,
        remark: <NameStepText part="remark" />,
        body: <NameStepBody {...params} />,
    }
}
