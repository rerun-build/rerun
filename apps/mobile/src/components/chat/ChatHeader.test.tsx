import { fireEvent, render, screen } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import { Platform, StyleSheet } from 'react-native'

import { ChatHeader, type ChatTab } from './ChatHeader'

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native-svg', () => {
    const Shape = () => null
    return { __esModule: true, default: Shape, Svg: Shape, Path: Shape, G: Shape, Circle: Shape, Rect: Shape, Defs: Shape, LinearGradient: Shape, RadialGradient: Shape, Stop: Shape, Polygon: Shape, Ellipse: Shape, Line: Shape, ClipPath: Shape, Mask: Shape }
})
jest.mock('@/components/ui/NativeMenu', () => {
    const { Pressable, Text } = jest.requireActual('react-native')
    const Pass = ({ children }: { children?: ReactNode }) => children ?? null
    const Item = ({ label, onPress }: { label: string; onPress: () => void }) => (
        <Pressable onPress={onPress}>
            <Text>{label}</Text>
        </Pressable>
    )
    return { NativeMenu: Pass, MenuItem: Item, MenuToggle: () => null, MenuSection: Pass, SubMenu: Pass, CircleTrigger: () => null }
})

const coworker = { id: 'pulse', kind: 'coworker' as const, name: 'Support', status: 'idle' as const }
const tabs: ChatTab[] = [
    { id: 'g', title: null, running: false, empty: false, kind: 'general' },
    { id: 't', title: 'Weekly quota failure on the support inbox', running: false, empty: false },
]

const describeOnIos = Platform.OS === 'ios' ? describe : describe.skip

// The pill hugs the name and the title of the conversation on screen, between a floor and the room the header leaves.
describeOnIos('the chat header pill', () => {
    const renderHeader = async (activeId: string) => {
        await render(<ChatHeader coworker={coworker} tabs={tabs} activeId={activeId} progress={{ value: tabs.findIndex(tab => tab.id === activeId) } as never} allSessions={tabs} onBack={() => {}} onSelect={() => {}} onNewSession={() => {}} />)
    }
    const titleArea = () => screen.getByTestId('chat-header-titles')
    const widthOf = (node: ReturnType<typeof titleArea>) => StyleSheet.flatten(node.props.style).width as number

    const measure = async (text: string, width: number) => {
        let node = screen.getByText(text).parent
        while (node && !node.props.onLayout) node = node.parent
        await fireEvent(node!, 'layout', { nativeEvent: { layout: { width, height: 36, x: 0, y: 0 } } })
    }

    it('narrows to a short title', async () => {
        await renderHeader('g')
        await measure('General', 74)
        expect(widthOf(titleArea())).toBe(74)
    })

    it('stops at the room the header leaves for a long one', async () => {
        await renderHeader('t')
        await measure('Weekly quota failure on the support inbox', 900)
        expect(widthOf(titleArea())).toBeLessThan(240)
    })
})

describe('the conversations menu', () => {
    const renderMenu = (onCloseSession?: () => void) => render(<ChatHeader coworker={coworker} tabs={tabs} activeId="t" progress={{ value: 1 } as never} allSessions={tabs} onBack={() => {}} onSelect={() => {}} onNewSession={() => {}} onCloseSession={onCloseSession} />)

    it('closes the thread on screen', async () => {
        const close = jest.fn()
        await renderMenu(close)
        await fireEvent.press(screen.getByText('Close conversation'))
        expect(close).toHaveBeenCalledTimes(1)
    })

    it('closes nothing on General nor on the draft', async () => {
        await renderMenu()
        expect(screen.queryByText('Close conversation')).toBeNull()
    })
})
