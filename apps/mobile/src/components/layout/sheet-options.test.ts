import { Platform } from 'react-native'

import { sheetOptions } from '@/components/layout/sheet-options'
import { palette, radius } from '@/theme/tokens'

describe('sheetOptions', () => {
    it('presents the screen as a sheet at its detents, on the background of the theme', () => {
        expect(sheetOptions('dark', [0.6, 1])).toMatchObject({ presentation: 'formSheet', sheetAllowedDetents: [0.6, 1], contentStyle: { backgroundColor: palette.dark.background } })
    })

    it("rounds the sheet's corners on Android, where iOS draws the grabber", () => {
        const options = sheetOptions('light', [1])
        if (Platform.OS === 'android') expect(options).toMatchObject({ sheetCornerRadius: radius.xl })
        else expect(options).toMatchObject({ sheetGrabberVisible: true })
    })
})
