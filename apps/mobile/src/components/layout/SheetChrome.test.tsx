import { render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { SheetChrome } from '@/components/layout/SheetChrome'

describe('SheetChrome', () => {
    it('draws a grabber and the top edge on Android, where the sheet has neither, and nothing on iOS', async () => {
        await render(<SheetChrome />)
        if (Platform.OS === 'android') {
            expect(screen.getByTestId('sheet-grabber')).toBeTruthy()
            expect(screen.getByTestId('sheet-edge')).toBeTruthy()
        } else {
            expect(screen.toJSON()).toBeNull()
        }
    })
})
