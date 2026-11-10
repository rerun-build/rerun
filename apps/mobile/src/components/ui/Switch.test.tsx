import { render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { TONES } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'
import { palette } from '@/theme/tokens'

const onAndroid = Platform.OS === 'android'

describe('Switch', () => {
    it("draws the iOS switch's colours on Android instead of the Material teal and violet", async () => {
        await render(<Switch testID="on" value onValueChange={() => {}} />)
        const on = screen.getByTestId('on')
        if (onAndroid) {
            expect(on.props.thumbTintColor).toBe('#ffffff')
            expect(on.props.trackColorForTrue).toBe(TONES.green.light)
            expect(on.props.trackColorForFalse).toBe(palette.light.input)
        } else {
            expect(on.props.thumbTintColor).toBeUndefined()
            expect(on.props.onTintColor).toBeUndefined()
        }
    })

    it('keeps the track colour a screen asks for', async () => {
        await render(<Switch testID="brand" value onValueChange={() => {}} trackColor={{ true: TONES.brand.light }} />)
        const brand = screen.getByTestId('brand')
        expect(onAndroid ? brand.props.trackColorForTrue : brand.props.onTintColor).toBe(TONES.brand.light)
    })
})
