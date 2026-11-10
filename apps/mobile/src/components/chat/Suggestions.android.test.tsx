import { fireEvent, render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { Suggestions } from '@/components/chat/Suggestions'

const describeOnAndroid = Platform.OS === 'android' ? describe : describe.skip

describeOnAndroid('Suggestions on Android', () => {
    it('draws each reply as a pill that sends it', async () => {
        const onPick = jest.fn()
        await render(<Suggestions items={['Show me the leads', 'Stop here']} onPick={onPick} />)
        expect(screen.getAllByRole('button')).toHaveLength(2)
        await fireEvent.press(screen.getByRole('button', { name: 'Stop here' }))
        expect(onPick).toHaveBeenCalledWith('Stop here')
    })
})
