'use client'

import { Field } from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useNotificationPrefs } from '@/hooks/useNotificationPrefs'
import { coworkerRuleOf, taskKey, taskNotifies } from '@/lib/notifications/prefs'
import type { TaskSource } from '@/lib/schedules/outcomes'
import { useTranslations } from 'next-intl'

// Whether this one task reaches you when it finishes. Saved on its own, like every notification
// setting: it is yours, the task's Save is for the task.
export function TaskNotifyField({ agentId, source, slug }: { agentId: string; source: TaskSource; slug: string }) {
    const t = useTranslations('agent.taskNotifyField')
    const { prefs, update } = useNotificationPrefs()
    const muted = coworkerRuleOf(prefs, agentId).mode === 'muted'
    const checked = taskNotifies(prefs, agentId, source, slug)

    return (
        <Field orientation="row" label={t('label')}>
            <TooltipDisabledReason reason={muted ? t('muted') : undefined}>
                <Switch checked={checked} disabled={muted} onCheckedChange={on => update({ tasks: { [taskKey(agentId, source, slug)]: on } })} />
            </TooltipDisabledReason>
        </Field>
    )
}
