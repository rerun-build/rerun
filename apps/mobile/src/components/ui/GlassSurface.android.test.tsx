import { render, screen } from '@testing-library/react-native'
import { Platform, StyleSheet, Text } from 'react-native'

import { GlassSurface } from '@/components/ui/GlassSurface'
import { palette } from '@/theme/tokens'

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnAndroid('GlassSurface on Android', () => {
    it('draws an opaque card of the forced scheme, with a hairline, in place of the glass', async () => {
        await render(
            <GlassSurface testID="surface" colorScheme="dark" glassEffectStyle="regular" isInteractive tintColor="#ffffff" style={{ borderRadius: 20 }}>
                <Text>Queued</Text>
            </GlassSurface>,
        )
        const style = StyleSheet.flatten(screen.getByTestId('surface').props.style)
        expect(style).toMatchObject({ backgroundColor: 'rgba(23, 23, 23, 0.92)', borderColor: palette.dark.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 20 })
        expect(screen.getByTestId('surface').props.tintColor).toBeUndefined()
        expect(screen.getByText('Queued')).toBeTruthy()
    })

    it('lets the caller set its own border', async () => {
        await render(<GlassSurface testID="surface" style={{ borderWidth: 0 }} />)
        expect(StyleSheet.flatten(screen.getByTestId('surface').props.style).borderWidth).toBe(0)
    })
})
