import { Box, Column, Image, Row, Spacer, Text } from '@expo/ui/jetpack-compose'
import { background, cornerRadius, fillMaxSize, fillMaxWidth, height, padding, paddingAll, size, width } from '@expo/ui/jetpack-compose/modifiers'
import { createWidget, type WidgetEnvironment } from 'expo-widgets'

import { EMPTY_CREW_WIDGET, type CrewWidgetProps } from './crew-props'

// The medium "Crew" widget of iOS, in the components and modifiers Android widgets support: no
// links per row (a tap opens the app), no lock screen.
const CrewWidget = (props: CrewWidgetProps, environment: WidgetEnvironment) => {
    'widget'
    const BRAND = '#4d34f7'
    const dark = environment.colorScheme === 'dark'
    const surface = dark ? '#1c1c1e' : '#ffffff'
    const primary = dark ? '#ffffff' : '#000000'
    const secondary = dark ? '#8e8e93' : '#6c6c70'
    const fill = dark ? '#2c2c2e' : '#f2f2f7'

    return (
        <Row horizontalArrangement={{ spacedBy: 12 }} modifiers={[fillMaxSize(), background(surface), cornerRadius(22), paddingAll(14)]}>
            <Column modifiers={[width(64)]}>
                <Text color={BRAND} style={{ fontSize: 10, fontWeight: 'bold' }}>{props.crewLabel.toUpperCase()}</Text>
                <Text color={primary} style={{ fontSize: 34, fontWeight: '300' }}>{String(props.count)}</Text>
                <Text color={secondary} style={{ fontSize: 11 }}>{props.countCaption}</Text>
            </Column>
            <Column verticalArrangement={{ spacedBy: 6 }} modifiers={[fillMaxWidth()]}>
                {props.members.map(member => (
                    <Row key={member.id} verticalAlignment="center" horizontalArrangement={{ spacedBy: 8 }} modifiers={[fillMaxWidth(), height(36), background(fill), cornerRadius(9), padding(6, 0, 8, 0)]}>
                        {member.face ? <Image source={{ uri: member.face }} modifiers={[size(24, 24)]} /> : <Spacer modifiers={[size(24, 24)]} />}
                        <Column modifiers={[width(150)]}>
                            <Text color={primary} maxLines={1} style={{ fontSize: 12, fontWeight: 'bold' }}>{member.name}</Text>
                            <Text color={secondary} maxLines={1} style={{ fontSize: 10 }}>{member.line}</Text>
                        </Column>
                        {member.state === 'waiting' ? (
                            <Box modifiers={[background(BRAND), cornerRadius(5), padding(6, 3, 6, 3)]}>
                                <Text color="#ffffff" style={{ fontSize: 9, fontWeight: 'bold' }}>{member.badge.toUpperCase()}</Text>
                            </Box>
                        ) : (
                            <Text color={member.state === 'error' ? '#ff3b30' : secondary} style={{ fontSize: 10 }}>{member.badge}</Text>
                        )}
                    </Row>
                ))}
            </Column>
        </Row>
    )
}

export default createWidget('Crew', CrewWidget, EMPTY_CREW_WIDGET)
