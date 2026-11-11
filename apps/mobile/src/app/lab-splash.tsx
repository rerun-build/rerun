import { useEffect, useEffectEvent, useState } from 'react'
import { Pressable, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SkeletonFade, useBootFill } from '@/components/home/BootFill'
import { CoworkerRow } from '@/components/home/CoworkerRow'
import { HomeBoot } from '@/components/home/HomeBoot'
import { HomeHeader } from '@/components/home/HomeHeader'
import { HomeSkeleton } from '@/components/home/HomeSkeleton'
import { BOTTOM_BAR_SIZE, HomeBottomBar, bottomBarInset } from '@/components/home/HomeBottomBar'
import { AppText } from '@/components/ui/AppText'
import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { statusLine } from '@/components/ui/status'
import { coworkers, sessions } from '@/mocks/data'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

// Dev only: the cold start played over a mock Home, to judge it, replay it and slow it down. The
// launch screen is stood in for by HomeBoot, which draws the same skeleton.

const LAUNCH_HOLD = 700
const READ_DELAY = 300
const SETTLE = 900
const SLOW_FACTOR = 4
const ROW_IDS = ['agent-scout', 'agent-ledger', 'agent-pulse', 'agent-inbox', 'agent-recap']

export default function SplashLab() {
    const [slow, setSlow] = useState(false)
    const [run, setRun] = useState(0)
    const [finishedRun, setFinishedRun] = useState<string | null>(null)
    const key = `${run}-${slow}`

    return (
        <View style={{ flex: 1 }}>
            <Stage key={key} pace={slow ? SLOW_FACTOR : 1} onDone={() => setFinishedRun(key)} />
            <Controls shown={finishedRun === key} slow={slow} onReplay={() => setRun(current => current + 1)} onSlow={() => setSlow(current => !current)} />
        </View>
    )
}

function Stage({ pace, onDone }: { pace: number; onDone: () => void }) {
    const [phase, setPhase] = useState<'launch' | 'home' | 'ready'>('launch')
    const finish = useEffectEvent(onDone)

    useEffect(() => {
        const timers = [setTimeout(() => setPhase('home'), LAUNCH_HOLD), setTimeout(() => setPhase('ready'), LAUNCH_HOLD + READ_DELAY * pace), setTimeout(finish, LAUNCH_HOLD + (READ_DELAY + SETTLE) * pace)]
        return () => timers.forEach(clearTimeout)
    }, [pace])

    if (phase === 'launch') return <HomeBoot />
    return <MockHome ready={phase === 'ready'} pace={pace} />
}

function MockHome({ ready, pace }: { ready: boolean; pace: number }) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    const fill = useBootFill(ready, { replay: true, pace })
    const byId = (id: string) => coworkers.find(coworker => coworker.id === id)!

    return (
        <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: insets.top + spacing.sm + GLASS_BUTTON_SIZE + spacing.xl }}>
            {ready ? (
                <View>
                    {ROW_IDS.map((id, index) => {
                        const coworker = byId(id)
                        return (
                            <Animated.View key={id} entering={fill.rowEntering(index)}>
                                <CoworkerRow
                                    coworker={coworker}
                                    line={statusLine(
                                        coworker,
                                        sessions.find(session => session.coworkerId === id)
                                    )}
                                    minutesAgo={coworker.updatedMinutesAgo}
                                    unread={coworker.unread}
                                    onPress={() => {}}
                                />
                            </Animated.View>
                        )
                    })}
                    {fill.playing && <SkeletonFade reveal={fill.reveal} staggered={fill.staggered} />}
                </View>
            ) : (
                <HomeSkeleton />
            )}

            <Animated.View entering={fill.chromeEntering} pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + spacing.sm, left: 0, right: 0 }}>
                <HomeHeader inboxCount={2} onInbox={() => {}} onNewCoworker={() => {}} />
            </Animated.View>
            <Animated.View entering={fill.chromeEntering} pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: bottomBarInset(insets.bottom) }}>
                <HomeBottomBar onSearch={() => {}} />
            </Animated.View>
        </View>
    )
}

type ControlsProps = { shown: boolean; slow: boolean; onReplay: () => void; onSlow: () => void }

function Controls({ shown, slow, onReplay, onSlow }: ControlsProps) {
    const theme = useTheme()
    const insets = useSafeAreaInsets()
    if (!shown) return null
    const chip = (label: string, active: boolean, onPress: () => void) => (
        <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={({ pressed }) => ({ minWidth: 44, height: 44, paddingHorizontal: spacing.md, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.foreground : 'transparent', opacity: pressed ? 0.6 : 1 })}>
            <AppText variant="callout" medium style={{ color: active ? theme.background : theme.foreground }}>
                {label}
            </AppText>
        </Pressable>
    )
    return (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: bottomBarInset(insets.bottom) + BOTTOM_BAR_SIZE + spacing.lg, alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', padding: spacing.xs, borderRadius: radius.pill, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}>
                {chip('Replay', false, onReplay)}
                {chip('Slow', slow, onSlow)}
            </View>
        </View>
    )
}
