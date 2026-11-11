import { fireEvent, render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { GlassButton, GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnAndroid('GlassButton on Android', () => {
    it('is a round button with its label and the Android ripple', async () => {
        const onPress = jest.fn()
        await render(<GlassButton symbol="x" label="Close" onPress={onPress} />)
        const button = screen.getByRole('button', { name: 'Close' })
        expect(button.props.style).toMatchObject({ width: GLASS_BUTTON_SIZE, height: GLASS_BUTTON_SIZE, borderRadius: GLASS_BUTTON_SIZE / 2 })
        await fireEvent.press(button)
        expect(onPress).toHaveBeenCalled()
    })

    it('ignores a press while disabled and says so', async () => {
        const onPress = jest.fn()
        await render(<GlassButton symbol="x" label="Close" disabled onPress={onPress} />)
        const button = screen.getByRole('button', { name: 'Close' })
        expect(button).toBeDisabled()
        await fireEvent.press(button)
        expect(onPress).not.toHaveBeenCalled()
    })
})
