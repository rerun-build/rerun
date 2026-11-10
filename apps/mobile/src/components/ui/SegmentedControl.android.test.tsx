import { fireEvent, render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { SegmentedControl } from '@/components/ui/SegmentedControl'

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

const OPTIONS = [
    { value: 'media', label: 'Media' },
    { value: 'doc', label: 'Docs' },
] as const

describeOnAndroid('SegmentedControl on Android', () => {
    it('is a row of tabs, the chosen one selected, a tap choosing another', async () => {
        const onChange = jest.fn()
        await render(<SegmentedControl options={OPTIONS} value="media" onChange={onChange} />)
        expect(screen.getByRole('tab', { name: 'Media' })).toBeSelected()
        expect(screen.getByRole('tab', { name: 'Docs' })).not.toBeSelected()
        await fireEvent.press(screen.getByRole('tab', { name: 'Docs' }))
        expect(onChange).toHaveBeenCalledWith('doc')
    })
})
