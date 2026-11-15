import { Fragment as MockFragment } from 'react'
import { act, render, screen } from '@testing-library/react-native'

import { fetchForemanConversation } from '@/api/foreman'

import { ForemanChat } from './ForemanChat'

jest.mock('use-intl', () => ({ useTranslations: () => (key: string) => key }))
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Path: () => null }))
jest.mock('expo-router', () => ({ router: { setParams: jest.fn() }, useFocusEffect: jest.fn() }))
jest.mock('react-native-reanimated', () => ({ useSharedValue: (value: number) => ({ value }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))
jest.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ session: { access_token: 'token' }, me: { workspace: { id: 7 } } }) }))
jest.mock('@/chat/pending-ask', () => ({ takePendingAsk: () => undefined }))
jest.mock('@/chat/endpoints', () => ({ foremanEndpoints: () => ({}) }))
jest.mock('@/components/layout/useChatBack', () => ({ useChatBack: () => jest.fn() }))
jest.mock('@/components/orb/ForemanOrb', () => ({ ForemanOrb: () => null }))
jest.mock('@/components/ui/AppText', () => ({ AppText: () => null }))
jest.mock('@/components/ui/PillButton', () => ({ PillButton: () => null }))
jest.mock('@/lib/haptics', () => ({ selectionAsync: jest.fn() }))
jest.mock('@/theme/theme', () => ({ useTheme: () => ({ background: '#fff' }) }))
jest.mock('@/data/local-cache', () => ({ cachedForeman: () => ({ read: () => null, save: jest.fn() }) }))
jest.mock('@/api/models', () => ({ fetchAgentModels: () => Promise.resolve(null) }))
jest.mock('@/api/foreman', () => ({
    fetchForemanConversation: jest.fn(),
    fetchForemanSurface: () => Promise.resolve('engine'),
    fetchForemanEngineFiles: () => Promise.resolve(false)
}))
jest.mock('./useOpenChats', () => {
    const { useCallback, useState } = require('react')
    return {
        useOpenChats: () => {
            const [ids, setIds] = useState([] as string[])
            const open = useCallback((id: string) => setIds((current: string[]) => (current.includes(id) ? current : [...current, id])), [])
            return [ids, open]
        }
    }
})
jest.mock('./ChatHeader', () => ({
    CHAT_HEADER_HEIGHT: 0,
    ChatHeader: ({ tabs }: { tabs: { id: string; title: string | null }[] }) => {
        const { Text: Label } = require('react-native')
        return tabs.map(tab => <Label key={tab.id}>{`tab ${tab.id}: ${tab.title ?? 'untitled'}`}</Label>)
    }
}))
jest.mock('./ComposerControls', () => ({ CONTROL: 0 }))
jest.mock('./ConversationSkeleton', () => ({ ConversationSkeleton: () => null }))
jest.mock('./ConversationPager', () => ({
    ConversationPager: ({ pages, renderPage }: { pages: unknown[]; renderPage: (page: unknown, onScreen: boolean) => import('react').ReactNode }) => pages.map((page, index) => <MockFragment key={index}>{renderPage(page, index === 0)}</MockFragment>)
}))
jest.mock('./ConversationPane', () => {
    const { Text: Label } = require('react-native')
    return {
        BLUR_ABOVE_FOOTER: 0,
        ConversationPane: ({ onSessionCreated }: { onSessionCreated: (id: string) => void }) => {
            ;(globalThis as { born?: (id: string) => void }).born = onSessionCreated
            return <Label>pane</Label>
        }
    }
})

const read = fetchForemanConversation as jest.Mock
const titled = { sessionId: 's1', title: 'Plan the launch', activeRunId: null }
const untitled = { sessionId: 's1', title: null, activeRunId: null }

const mount = async () => {
    const view = await render(<ForemanChat sessionId="new" />)
    await act(async () => {})
    read.mockClear()
    jest.useFakeTimers()
    await act(async () => {
        ;(globalThis as unknown as { born: (id: string) => void }).born('s1')
    })
    return view
}

const tick = (ms: number) => act(async () => { await jest.advanceTimersByTimeAsync(ms) })

describe('ForemanChat title after a new conversation', () => {
    beforeEach(() => {
        read.mockReset()
        read.mockResolvedValue(null)
    })
    afterEach(() => jest.useRealTimers())

    it('reads again until the server has written the title, then shows it', async () => {
        await mount()
        read.mockReset()
        read.mockResolvedValueOnce(untitled).mockResolvedValueOnce(untitled).mockResolvedValue(titled)
        await tick(20000)
        expect(screen.getByText('tab s1: Plan the launch')).toBeTruthy()
        expect(read).toHaveBeenCalledTimes(3)
    })

    it('stops reading once the title is there', async () => {
        read.mockResolvedValue(titled)
        await mount()
        await tick(60000)
        expect(read).toHaveBeenCalledTimes(1)
    })

    it('gives up after a bounded number of reads when no title comes', async () => {
        read.mockResolvedValue(untitled)
        await mount()
        await tick(120000)
        const settled = read.mock.calls.length
        expect(settled).toBeGreaterThan(1)
        expect(settled).toBeLessThanOrEqual(6)
        await tick(120000)
        expect(read).toHaveBeenCalledTimes(settled)
    })

    it('makes no read after the screen is closed', async () => {
        read.mockResolvedValue(untitled)
        const view = await mount()
        view.unmount()
        read.mockClear()
        await tick(120000)
        expect(read).not.toHaveBeenCalled()
    })
})
