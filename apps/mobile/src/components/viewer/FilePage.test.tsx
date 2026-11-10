import { render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { FilePage } from '@/components/viewer/FilePage'

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native-webview', () => {
    const { View: MockView } = jest.requireActual('react-native')
    return { WebView: () => <MockView testID="web-view" /> }
})

const NO_PREVIEW = 'No preview for this file. Share it to open it in another app.'

describe('FilePage', () => {
    it('reads a text file in the web view', async () => {
        await render(<FilePage url="https://hub/notes.md" name="notes.md" load={() => Promise.resolve('file:///cache/notes.md')} />)
        expect(await screen.findByTestId('web-view')).toBeTruthy()
    })

    it('sends a PDF to another app on Android instead of a blank page, and reads it in place on iOS', async () => {
        await render(<FilePage url="https://hub/board.pdf" name="Board review Q3.pdf" load={() => Promise.resolve('file:///cache/board.pdf')} />)
        if (Platform.OS === 'android') {
            expect(await screen.findByText(NO_PREVIEW)).toBeTruthy()
            expect(screen.queryByTestId('web-view')).toBeNull()
        } else {
            expect(await screen.findByTestId('web-view')).toBeTruthy()
        }
    })
})
