import { render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { ProgressiveBlur } from '@/components/ui/ProgressiveBlur'

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnAndroid('ProgressiveBlur on Android', () => {
    it.each([true, false])('fades the background in without a blur view (veiled: %s)', async veiled => {
        await render(<ProgressiveBlur height={80} veiled={veiled} />)
        expect(JSON.stringify(screen.toJSON())).not.toMatch(/BlurView|MaskedView|RNCMaskedView/)
    })
})
