import { AppState, Platform } from 'react-native'

import CrewActivity from './CrewActivity'
import type { CrewWidgetProps } from './crew-props'

// What the Live Activity should do with the crew the app just read: one activity for the whole crew,
// up while someone works or waits, gone once nobody does. iOS only lets an app in the foreground start
// one; the background refresh of a push can update or end it.
export type ActivityStep = 'start' | 'update' | 'end' | 'none'

export function activityStepOf(props: CrewWidgetProps, running: boolean, foreground: boolean): ActivityStep {
    const live = props.members.some(member => member.state !== 'error')
    if (!live) return running ? 'end' : 'none'
    if (running) return 'update'
    return foreground ? 'start' : 'none'
}

export async function syncCrewActivity(props: CrewWidgetProps): Promise<void> {
    if (Platform.OS !== 'ios') return
    try {
        const [current, ...strays] = CrewActivity.getInstances()
        await Promise.all(strays.map(stray => stray.end('immediate')))
        const step = activityStepOf(props, Boolean(current), AppState.currentState === 'active')
        if (step === 'start') CrewActivity.start(props, 'rerun://')
        if (step === 'update') await current?.update(props)
        if (step === 'end') await current?.end('default', props)
    } catch (error) {
        // Turned off in Settings, or the system's budget of activities is spent: the widgets still show it.
        console.warn('[live activity] not updated', error)
    }
}
