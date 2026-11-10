'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { setRerunCreditPausedAction } from '@/ee/actions/billing.actions'
import { Field } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'

// On by default. Off, the hub refuses every Rerun model and paid data call, so nothing is spent until
// a member turns it back on. The workspace row follows over realtime, the switch only holds the click.
export function RerunCreditSwitch({ paused }: { paused: boolean }) {
    const t = useTranslations('billing')
    const errorText = useErrorText()
    const [optimistic, setOptimistic] = useState<boolean | null>(null)
    const [saving, setSaving] = useState(false)
    const on = optimistic ?? !paused

    useEffect(() => setOptimistic(null), [paused])

    async function toggle(next: boolean) {
        setOptimistic(next)
        setSaving(true)
        const result = await setRerunCreditPausedAction(!next)
        setSaving(false)
        if (result.ok) return
        setOptimistic(null)
        toast.error(errorText(result))
    }

    return (
        <Field orientation="row" label={t('usage.switch.label')} helperText={on ? t('usage.switch.on') : t('usage.switch.off')} className="flex-1">
            <Switch checked={on} disabled={saving} onCheckedChange={toggle} />
        </Field>
    )
}
