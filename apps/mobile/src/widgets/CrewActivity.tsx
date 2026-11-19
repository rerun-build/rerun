import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { activityBackgroundTint, background, clipShape, font, foregroundStyle, frame, lineLimit, monospacedDigit, padding, resizable } from '@expo/ui/swift-ui/modifiers'
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets'

import type { CrewWidgetProps } from './crew-props'

// The lab's "crew" island (render/lab/outside-app): the coworker who counts on the left, its clock
// tinted on the right, the crew in tiles across the bottom. Black and flat, as Fitness or Citizen.
// The clocks are SwiftUI's own timers: they run without any update from the app.
const CrewActivity = (props: CrewWidgetProps, environment: LiveActivityEnvironment) => {
    'widget'
    const TINT = '#a99cff'
    const GREY = '#98989f'
    const TILE = '#1c1c1e'
    const focus = props.members[0]
    const asking = focus?.state === 'waiting'
    const busy = props.members.filter(member => member.state !== 'error').length
    const dim = environment.isLuminanceReduced

    const face = (uri: string | undefined, size: number) => (uri ? <Image uiImage={uri} modifiers={[resizable(), frame({ width: size, height: size })]} /> : <Spacer modifiers={[frame({ width: size, height: size })]} />)
    const clock = (since: string | null | undefined, size: number) => (since ? <Text date={new Date(since)} dateStyle="timer" modifiers={[font({ size, weight: 'semibold' }), monospacedDigit(), foregroundStyle(dim ? '#ffffff' : TINT), frame({ maxWidth: 80, alignment: 'trailing' })]} /> : <Text> </Text>)
    // A coworker stopped on an error runs no clock: it says so, as its tile does.
    const standing = (size: number) => (focus?.state === 'error' ? <Text modifiers={[font({ size, weight: 'semibold' }), foregroundStyle(GREY)]}>{focus.badge}</Text> : clock(focus?.since, size))
    const title = focus ? (asking ? props.asksLine : focus.name) : props.headline
    const subtitle = focus ? `${focus.line}${props.othersLine ? ` · ${props.othersLine}` : ''}` : ''

    const tiles = (
        <HStack spacing={6}>
            {props.members.map(member => (
                <VStack key={member.id} spacing={2} modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 6 }), background(TILE), clipShape('roundedRectangle', 14)]}>
                    {face(member.face, 22)}
                    <Text modifiers={[font({ size: 10, weight: 'semibold' }), lineLimit(1), foregroundStyle('#ffffff')]}>{member.name}</Text>
                    {member.state === 'working' ? clock(member.since, 10) : <Text modifiers={[font({ size: 10 }), foregroundStyle(member.state === 'waiting' ? TINT : GREY)]}>{member.badge}</Text>}
                </VStack>
            ))}
        </HStack>
    )

    return {
        banner: (
            <VStack alignment="leading" spacing={10} modifiers={[padding({ all: 16 }), activityBackgroundTint('#000000')]}>
                <HStack spacing={12}>
                    {face(focus?.face, 44)}
                    <VStack alignment="leading" spacing={2}>
                        <Text modifiers={[font({ size: 16, weight: 'semibold' }), lineLimit(1), foregroundStyle('#ffffff')]}>{title}</Text>
                        <Text modifiers={[font({ size: 13 }), lineLimit(1), foregroundStyle(GREY)]}>{subtitle}</Text>
                    </VStack>
                    <Spacer />
                    {asking ? null : standing(22)}
                </HStack>
                {props.members.length > 1 ? tiles : null}
            </VStack>
        ),
        compactLeading: (
            <HStack spacing={4}>
                {face(focus?.face, 22)}
                {busy > 1 ? <Text modifiers={[font({ size: 14, weight: 'semibold' }), monospacedDigit()]}>{String(busy)}</Text> : null}
            </HStack>
        ),
        compactTrailing: asking ? <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(TINT)]}>{focus.badge}</Text> : standing(14),
        minimal: face(focus?.face, 22),
        expandedLeading: face(focus?.face, 40),
        expandedTrailing: asking ? <Text modifiers={[font({ size: 16, weight: 'semibold' }), foregroundStyle(TINT)]}>{props.needsYouLabel}</Text> : standing(22),
        expandedCenter: (
            <VStack alignment="leading" spacing={2}>
                <Text modifiers={[font({ size: 16, weight: 'semibold' }), lineLimit(1)]}>{title}</Text>
                <Text modifiers={[font({ size: 13 }), lineLimit(1), foregroundStyle(GREY)]}>{subtitle}</Text>
            </VStack>
        ),
        expandedBottom: props.members.length > 1 ? tiles : undefined,
    }
}

export default createLiveActivity('Crew', CrewActivity)
