import { render, screen } from '@testing-library/react-native'
import { Platform } from 'react-native'

import { FilePage } from '@/components/viewer/FilePage'

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native-webview', () => {
    const { Text: MockText } = jest.requireActual('react-native')
    return { WebView: ({ source }: { source: { uri?: string; html?: string } }) => <MockText testID="web-view">{source.html ?? source.uri}</MockText> }
})
jest.mock('expo-file-system', () => ({
    File: class {
        textSync() {
            return '# Prospects\n<b>Acme</b>'
        }
    },
}))

const NO_PREVIEW = 'No preview for this file. Share it to open it in another app.'
const onAndroid = Platform.OS === 'android'

describe('FilePage', () => {
    it('loads a web page from its local copy', async () => {
        await render(<FilePage url="https://hub/report.html" name="report.html" load={() => Promise.resolve('file:///cache/report.html')} />)
        expect(await screen.findByText('file:///cache/report.html')).toBeTruthy()
    })

    it('shows a text file as text on Android, where the web view would try to download it', async () => {
        await render(<FilePage url="https://hub/notes.md" name="notes.md" load={() => Promise.resolve('file:///cache/notes.md')} />)
        const page = await screen.findByTestId('web-view')
        if (onAndroid) expect(page).toHaveTextContent(/<pre[^>]*># Prospects\s&lt;b&gt;Acme&lt;\/b&gt;<\/pre>/)
        else expect(page).toHaveTextContent('file:///cache/notes.md')
    })

    it('sends a PDF to another app on Android instead of a blank page, and reads it in place on iOS', async () => {
        await render(<FilePage url="https://hub/board.pdf" name="Board review Q3.pdf" load={() => Promise.resolve('file:///cache/board.pdf')} />)
        if (onAndroid) {
            expect(await screen.findByText(NO_PREVIEW)).toBeTruthy()
            expect(screen.queryByTestId('web-view')).toBeNull()
        } else {
            expect(await screen.findByTestId('web-view')).toBeTruthy()
        }
    })
})
