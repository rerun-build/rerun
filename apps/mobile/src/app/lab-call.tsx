import { router, useLocalSearchParams } from 'expo-router'
import { Pressable, StatusBar, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { AuroraCall } from '@/call/prototypes/AuroraCall'
import { CaptionsCall } from '@/call/prototypes/CaptionsCall'
import { ClassicCall } from '@/call/prototypes/ClassicCall'
import { HaloCall } from '@/call/prototypes/HaloCall'
import { useMockCall, type MockPhase } from '@/call/prototypes/mock-call'
import { CALL_INK, CALL_MUTED, type PrototypeProps } from '@/call/prototypes/parts'
import { WorkbenchCall } from '@/call/prototypes/WorkbenchCall'
import { Icon } from '@/components/ui/Icon'
import { ThemeScope } from '@/theme/theme'
import { fonts } from '@/theme/tokens'

// Dev only: the prototypes of the call screen, side by side on one scripted call that loops.
// `rerun://lab-call?variant=aurora`, `&phase=thinking` holds a still frame, `&bar=0` hides the switcher.

const VARIANTS = [
    { key: 'aurora', label: 'Aurora', Screen: AuroraCall },
    { key: 'captions', label: 'Captions', Screen: CaptionsCall },
    { key: 'halo', label: 'Halo', Screen: HaloCall },
    { key: 'workbench', label: 'Workbench', Screen: WorkbenchCall },
    { key: 'classic', label: 'Classic', Screen: ClassicCall },
] as const satisfies { key: string; label: string; Screen: (props: PrototypeProps) => React.ReactNode }[]

const PHASES: MockPhase[] = ['ringing', 'listening', 'thinking', 'speaking']
const AGENT_ID = 'agent-scout'
const BAR_HEIGHT = 36

export default function CallLab() {
    const params = useLocalSearchParams<{ variant?: string; phase?: string; bar?: string }>()
    const index = Math.max(
        0,
        VARIANTS.findIndex(variant => variant.key === params.variant),
    )
    const phase = PHASES.find(each => each === params.phase) ?? null
    const showBar = params.bar !== '0'
    return (
        <ThemeScope scheme="dark">
            <StatusBar barStyle="light-content" />
            <Prototype key={`${index}-${phase}`} index={index} phase={phase} showBar={showBar} />
        </ThemeScope>
    )
}

function Prototype({ index, phase, showBar }: { index: number; phase: MockPhase | null; showBar: boolean }) {
    const insets = useSafeAreaInsets()
    const call = useMockCall(phase)
    const { Screen, label } = VARIANTS[index]
    const go = (step: number) => router.setParams({ variant: VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length].key })
    const top = insets.top + (showBar ? BAR_HEIGHT + 8 : 12)
    return (
        <View style={{ flex: 1 }}>
            <Screen call={call} agentId={AGENT_ID} name="Scout" top={top} onEnd={() => router.back()} />
            {showBar && (
                <View style={{ position: 'absolute', top: insets.top + 4, left: 0, right: 0, alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2, backgroundColor: 'rgba(255,255,255,0.1)' }}>
                        <Pressable onPress={() => go(-1)} hitSlop={8} accessibilityLabel="Previous prototype" style={{ width: BAR_HEIGHT, height: BAR_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="chevron-left" size={16} color={CALL_INK} />
                        </Pressable>
                        <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: CALL_INK, minWidth: 110, textAlign: 'center' }}>
                            {label}
                            <Text style={{ color: CALL_MUTED }}>{`  ${index + 1}/${VARIANTS.length}`}</Text>
                        </Text>
                        <Pressable onPress={() => go(1)} hitSlop={8} accessibilityLabel="Next prototype" style={{ width: BAR_HEIGHT, height: BAR_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="chevron-right" size={16} color={CALL_INK} />
                        </Pressable>
                    </View>
                </View>
            )}
        </View>
    )
}
