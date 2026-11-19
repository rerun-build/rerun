import { AppState, Platform } from 'react-native'

import { translatorFor } from '@/i18n/translator'

import CrewActivity from './CrewActivity'
import type { CrewWidgetProps } from './crew-props'
import { LiveUpdate } from './live-update'

// What the live surface (the Live Activity on iOS, the Live Update on Android) should do with the crew
// the app just read: one for the whole crew, up while someone works or waits, gone once nobody does.
// It starts with the app in the foreground only, which iOS requires and Android follows so that it
// never appears out of nowhere; the background refresh of a push can update or end it.
export type ActivityStep = 'start' | 'update' | 'end' | 'none'

export function activityStepOf(props: CrewWidgetProps, running: boolean, foreground: boolean): ActivityStep {
    const live = props.members.some(member => member.state !== 'error')
    if (!live) return running ? 'end' : 'none'
    if (running) return 'update'
    return foreground ? 'start' : 'none'
}

// Android 16 shows the chip in the status bar only while someone waits, and only a few characters of it.
async function syncLiveUpdate(props: CrewWidgetProps): Promise<void> {
    if (!LiveUpdate) return
    const step = activityStepOf(props, await LiveUpdate.isShowing(), AppState.currentState === 'active')
    if (step === 'end') return LiveUpdate.end()
    if (step === 'none') return
    const focus = props.members[0]
    const asking = focus?.state === 'waiting'
    await LiveUpdate.show(
        { title: asking ? props.asksLine : (focus?.name ?? props.headline), text: [focus?.line, props.othersLine].filter(Boolean).join(' · '), chip: asking ? props.needsYouLabel : null, url: focus?.url ?? 'rerun://' },
        translatorFor('mobileSettings')('notifications.channels.crew.name')
    )
}

// Taken down at once, without the closing state a crew that finished leaves on the lock screen.
export async function endCrewActivity(): Promise<void> {
    try {
        if (Platform.OS === 'android') await LiveUpdate?.end()
        if (Platform.OS === 'ios') await Promise.all(CrewActivity.getInstances().map(instance => instance.end('immediate')))
    } catch (error) {
        console.warn('[live activity] not ended', error)
    }
}

export async function syncCrewActivity(props: CrewWidgetProps): Promise<void> {
    if (Platform.OS === 'android') return syncLiveUpdate(props).catch(error => console.warn('[live update] not updated', error))
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
