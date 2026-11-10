import { Platform } from 'react-native'

import { fieldOutline } from '@/theme/field'
import { palette } from '@/theme/tokens'

const theme = { ...palette.light, scheme: 'light' as const }

describe('fieldOutline', () => {
    it('borders the field with the input colour at rest, the primary once focused, the destructive when invalid', () => {
        expect(fieldOutline(theme, { focused: false })).toMatchObject({ borderWidth: 1, borderColor: theme.input })
        expect(fieldOutline(theme, { focused: true })).toMatchObject({ borderColor: theme.primary })
        expect(fieldOutline(theme, { focused: true, invalid: true })).toMatchObject({ borderColor: theme.destructive })
    })

    it('never sets a box shadow on Android, where it resets the padding of a TextInput', () => {
        const focused = fieldOutline(theme, { focused: true })
        if (Platform.OS === 'android') expect(focused.boxShadow).toBeUndefined()
        else expect(focused.boxShadow).toContain('3px')
    })
})
