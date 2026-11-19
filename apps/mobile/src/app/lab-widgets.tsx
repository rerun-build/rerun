import { router } from 'expo-router'
import { View } from 'react-native'

import { CoworkerPage } from '@/components/coworker/CoworkerPage'
import type { HomeCoworker } from '@/components/home/board'
import { AppText } from '@/components/ui/AppText'
import { spacing } from '@/theme/tokens'
import { WidgetSync } from '@/widgets/WidgetSync'

// Dev only: the widgets fed with a crew of three, for a simulator with no workspace behind it.
//   /lab-widgets

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

function coworker(id: string, name: string, status: HomeCoworker['status'], title: string, minutes: number): HomeCoworker {
    return { id, name, handle: null, description: null, status, paused: false, spaceId: 'box', latest: { id: `conv-${id}`, title, updatedAt: minutesAgo(minutes) } as HomeCoworker['latest'], pending: 0, generalSessionId: null }
}

const CREW = [coworker('agent-closer', 'Closer', 'waiting_human', 'Approve 12 emails', 1), coworker('agent-scout', 'Lead Scout', 'working', 'Lyon agencies', 13), coworker('agent-writer', 'Ghostwriter', 'working', 'Newsletter #47', 4)]

export default function LabWidgets() {
    return (
        <CoworkerPage title="Widgets" onBack={() => router.back()}>
            <View style={{ padding: spacing.lg }}>
                <AppText tone="muted">Closer waits, Lead Scout and Ghostwriter work. Add the Your crew widget from the home screen.</AppText>
            </View>
            <WidgetSync coworkers={CREW} />
        </CoworkerPage>
    )
}
