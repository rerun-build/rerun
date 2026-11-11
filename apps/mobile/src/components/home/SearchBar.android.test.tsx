import { fireEvent, render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { SearchBar } from '@/components/home/SearchBar'

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnAndroid('SearchBar on Android', () => {
    it('is a capsule that opens the search', async () => {
        const onPress = jest.fn()
        await render(<SearchBar onPress={onPress} />)
        await fireEvent.press(screen.getByRole('search', { name: 'Search' }))
        expect(onPress).toHaveBeenCalled()
    })
})
