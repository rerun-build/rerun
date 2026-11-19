import { AccessoryWidgetBackground, HStack, Image, Link, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui'
import { background, clipShape, containerBackground, font, foregroundStyle, frame, lineLimit, offset, padding, resizable, textCase, widgetURL } from '@expo/ui/swift-ui/modifiers'
import { createWidget, type WidgetEnvironment } from 'expo-widgets'

import { EMPTY_CREW_WIDGET, type CrewWidgetProps } from './crew-props'

// The lab's flat look (render/lab/outside-app): system backgrounds, one idea per size, the brand's
// indigo only on a solid chip, the buddy large and cropped by the edge. On the lock screen iOS draws
// it all in its own translucent white.
const CrewWidget = (props: CrewWidgetProps, environment: WidgetEnvironment) => {
    'widget'
    const BRAND = '#4d34f7'
    const dark = environment.colorScheme === 'dark'
    const surface = dark ? '#1c1c1e' : '#ffffff'
    const secondary = dark ? '#8e8e93' : '#6c6c70'
    const fill = dark ? '#2c2c2e' : '#f2f2f7'
    const first = props.members[0]
    const home = 'rerun://'

    const chip = (label: string) => (
        <Text modifiers={[font({ size: 9, weight: 'bold' }), textCase('uppercase'), foregroundStyle('#ffffff'), padding({ horizontal: 6, vertical: 3 }), background(BRAND), clipShape('roundedRectangle', 5)]}>{label}</Text>
    )
    const face = (uri: string, size: number) => (uri ? <Image uiImage={uri} modifiers={[resizable(), frame({ width: size, height: size })]} /> : <Spacer modifiers={[frame({ width: size, height: size })]} />)

    if (environment.widgetFamily === 'accessoryInline') {
        return <Text modifiers={[widgetURL(home)]}>{props.headline}</Text>
    }

    if (environment.widgetFamily === 'accessoryCircular') {
        return (
            <ZStack modifiers={[containerBackground('clear', 'widget'), widgetURL(first?.url ?? home)]}>
                <AccessoryWidgetBackground />
                {first ? face(first.face, 40) : <Text modifiers={[font({ size: 22, weight: 'semibold' })]}>{String(props.count)}</Text>}
            </ZStack>
        )
    }

    if (environment.widgetFamily === 'accessoryRectangular') {
        return (
            <VStack alignment="leading" spacing={0} modifiers={[containerBackground('clear', 'widget'), widgetURL(first?.url ?? home), frame({ maxWidth: Infinity, alignment: 'leading' })]}>
                <Text modifiers={[font({ size: 14, weight: 'semibold' }), lineLimit(1)]}>{first ? props.asksLine : props.headline}</Text>
                {first ? <Text modifiers={[font({ size: 14 }), lineLimit(1)]}>{first.line}</Text> : null}
                {props.othersLine ? <Text modifiers={[font({ size: 14 }), lineLimit(1), foregroundStyle(secondary)]}>{props.othersLine}</Text> : null}
            </VStack>
        )
    }

    if (environment.widgetFamily === 'systemMedium') {
        return (
            <HStack alignment="top" spacing={12} modifiers={[containerBackground(surface, 'widget'), widgetURL(home)]}>
                <VStack alignment="leading" spacing={0} modifiers={[frame({ width: 64, alignment: 'leading' })]}>
                    <Text modifiers={[font({ size: 10, weight: 'semibold' }), textCase('uppercase'), foregroundStyle(BRAND)]}>{props.crewLabel}</Text>
                    <Text modifiers={[font({ size: 34, weight: 'light' })]}>{String(props.count)}</Text>
                    <Text modifiers={[font({ size: 11 }), foregroundStyle(secondary)]}>{props.countCaption}</Text>
                    <Spacer />
                </VStack>
                <VStack spacing={6}>
                    {props.members.map(member => (
                        <Link key={member.id} destination={member.url}>
                            <HStack spacing={8} modifiers={[padding({ leading: 6, trailing: 8 }), frame({ height: 34 }), frame({ maxWidth: Infinity }), background(fill), clipShape('roundedRectangle', 9)]}>
                                {face(member.face, 24)}
                                <VStack alignment="leading" spacing={0}>
                                    <Text modifiers={[font({ size: 11.5, weight: 'semibold' }), lineLimit(1)]}>{member.name}</Text>
                                    <Text modifiers={[font({ size: 10 }), lineLimit(1), foregroundStyle(secondary)]}>{member.line}</Text>
                                </VStack>
                                <Spacer />
                                {member.state === 'waiting' ? chip(member.badge) : <Text modifiers={[font({ size: 10 }), foregroundStyle(member.state === 'error' ? '#ff3b30' : secondary)]}>{member.badge}</Text>}
                            </HStack>
                        </Link>
                    ))}
                    <Spacer />
                </VStack>
            </HStack>
        )
    }

    const asking = first?.state === 'waiting'
    return (
        <ZStack alignment="topLeading" modifiers={[containerBackground(surface, 'widget'), widgetURL(first?.url ?? home)]}>
            <VStack alignment="leading" spacing={2} modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' })]}>
                {asking ? chip(props.needsYouLabel) : <Text modifiers={[font({ size: 40, weight: 'semibold' })]}>{String(props.count)}</Text>}
                <Text modifiers={[font({ size: asking ? 15 : 11, weight: asking ? 'semibold' : 'medium' }), lineLimit(3), foregroundStyle(asking ? (dark ? '#ffffff' : '#000000') : secondary), frame({ width: 92, alignment: 'leading' })]}>{asking ? first.line : props.countCaption}</Text>
                {asking ? <Text modifiers={[font({ size: 11 }), foregroundStyle(secondary)]}>{first.name}</Text> : null}
            </VStack>
            {first?.face ? <Image uiImage={first.face} modifiers={[resizable(), frame({ width: 104, height: 104 }), offset({ x: 70, y: 66 })]} /> : null}
        </ZStack>
    )
}

export default createWidget('Crew', CrewWidget, EMPTY_CREW_WIDGET)
