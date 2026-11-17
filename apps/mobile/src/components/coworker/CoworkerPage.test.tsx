import { render, screen } from '@testing-library/react-native'
import { StyleSheet, Text, type ViewStyle } from 'react-native'
import { SafeAreaCornerAdaptedInsetsContext, SafeAreaInsetsContext } from 'react-native-safe-area-context'

import { IPAD_WINDOWED_CORNER_INSETS, IPAD_WINDOWED_INSETS } from '@/test/window-controls'

import { CoworkerPage } from './CoworkerPage'

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: () => true } }))
jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native-svg', () => ({ __esModule: true, default: () => null, Path: () => null }))

type Element = ReturnType<typeof screen.getByText>

// How far from the window's left edge the paddings and margins of its ancestors push an element.
function leftOffset(element: Element): number {
    let offset = 0
    for (let node: Element | null = element.parent; node; node = node.parent) {
        if (typeof node.type !== 'string') continue
        for (const style of [node.props.style, node.props.contentContainerStyle]) {
            const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle
            offset += Number(flat.paddingLeft ?? flat.paddingHorizontal ?? flat.padding ?? 0) + Number(flat.marginLeft ?? flat.marginHorizontal ?? flat.margin ?? 0)
        }
    }
    return offset
}

describe('a coworker page in an iPad window', () => {
    // The title shares the back button's row; iOS draws that button natively, out of the test tree.
    it('keeps its header row clear of the window controls', async () => {
        await render(
            <SafeAreaInsetsContext.Provider value={IPAD_WINDOWED_INSETS}>
                <SafeAreaCornerAdaptedInsetsContext.Provider value={IPAD_WINDOWED_CORNER_INSETS}>
                    <CoworkerPage title="Routines" onBack={() => {}}>
                        <Text>Body</Text>
                    </CoworkerPage>
                </SafeAreaCornerAdaptedInsetsContext.Provider>
            </SafeAreaInsetsContext.Provider>
        )
        expect(leftOffset(screen.getByText('Routines'))).toBeGreaterThanOrEqual(IPAD_WINDOWED_CORNER_INSETS.horizontal.left)
        expect(leftOffset(screen.getByText('Body'))).toBeLessThan(IPAD_WINDOWED_CORNER_INSETS.horizontal.left)
    })
})
