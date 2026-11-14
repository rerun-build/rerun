'use client'

import { useState } from 'react'

import { listTriggersAction } from '@/app/api/_actions/agent.actions'
import { CoworkerBellMenu } from '@/components/notifications/settings/CoworkerBellMenu'
import { useNotificationPrefs } from '@/hooks/useNotificationPrefs'
import { useBoardStore } from '@/stores/board.store'
import { useNotificationsStore } from '@/stores/notifications.store'

export function CoworkerNotificationBell({ agentId, name }: { agentId: string; name: string }) {
    const { prefs, setCoworkerRule, ruleOf } = useNotificationPrefs()
    const scheduleCount = useBoardStore(s => s.agentSchedules.filter(schedule => schedule.agentId === agentId).length)
    const [triggerCount, setTriggerCount] = useState(0)

    const countTriggers = (open: boolean) => {
        if (!open) return
        listTriggersAction(agentId)
            .then(triggers => setTriggerCount(triggers.length))
            .catch(() => {})
    }

    return (
        <CoworkerBellMenu
            name={name}
            rule={ruleOf(agentId)}
            scope={prefs.scope}
            scheduledCount={scheduleCount + triggerCount}
            onChange={rule => setCoworkerRule(agentId, rule)}
            onOpenSettings={() => useNotificationsStore.getState().openNotifications(agentId)}
            onOpenChange={countTriggers}
            align="start"
        />
    )
}
