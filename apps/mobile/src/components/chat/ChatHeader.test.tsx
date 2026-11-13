import { render, screen } from '@testing-library/react-native'
import type { SharedValue } from 'react-native-reanimated'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { GLASS_BUTTON_SIZE } from '@/components/ui/GlassButton'
import { spacing } from '@/theme/tokens'

import { CHAT_HEADER_HEIGHT, ChatHeader } from './ChatHeader'

jest.mock('react-native-safe-area-context', () => jest.requireActual('react-native-safe-area-context/jest/mock').default)
jest.mock('@/components/ui/EdgeFade', () => {
    const React = require('react')
    const { View } = require('react-native')
    return { EdgeFade: ({ edge, height, solid }: { edge: string; height: number; solid?: number }) => React.createElement(View, { testID: `edge-fade:${edge}:${height}:${solid}` }) }
})
// The pill, the buttons and the menu host SwiftUI, which Jest cannot mount.
jest.mock('@/components/ui/GlassSurface', () => {
    const React = require('react')
    const { View } = require('react-native')
    return { GlassSurface: ({ children, style }: { children: unknown; style: unknown }) => React.createElement(View, { style }, children) }
})
jest.mock('@/components/ui/GlassButton', () => {
    const React = require('react')
    const { Pressable } = require('react-native')
    return {
        GLASS_BUTTON_SIZE: 44,
        GlassButton: ({ label, onPress }: { label: string; onPress: () => void }) => React.createElement(Pressable, { accessibilityLabel: label, accessibilityRole: 'button', onPress }),
        useGlassStyle: () => ({ style: 'regular', animate: true, animationDuration: 0.25 }),
    }
})
jest.mock('@/components/ui/NativeMenu', () => {
    const React = require('react')
    const { Pressable, View } = require('react-native')
    return {
        NativeMenu: ({ trigger, children }: { trigger: unknown; children: unknown }) => React.createElement(View, null, trigger, children),
        MenuItem: ({ label, onPress }: { label: string; onPress: () => void }) => React.createElement(Pressable, { accessibilityLabel: label, accessibilityRole: 'button', onPress }),
        MenuToggle: () => null,
        MenuSection: ({ children }: { children: unknown }) => children,
        SubMenu: ({ children }: { children: unknown }) => children,
        CircleTrigger: () => null,
    }
})
jest.mock('@/components/ui/CoworkerAvatar', () => ({ CoworkerAvatar: () => null }))

const TOP = 59
const METRICS = { frame: { x: 0, y: 0, width: 320, height: 640 }, insets: { top: TOP, bottom: 34, left: 0, right: 0 } }
const COWORKER = { id: 'a1', kind: 'coworker' as const, name: 'Scout', status: 'idle' as const }
const TABS = [{ id: 's1', title: 'Leads in Lyon', running: false, empty: false }]

describe('ChatHeader', () => {
    it('hides the transcript down to the bottom of the pill, then fades it out where the thread starts', async () => {
        const progress = { value: 0 } as unknown as SharedValue<number>
        await render(
            <SafeAreaProvider initialMetrics={METRICS}>
                <ChatHeader coworker={COWORKER} tabs={TABS} activeId="s1" progress={progress} allSessions={TABS} onBack={jest.fn()} onSelect={jest.fn()} onNewSession={jest.fn()} />
            </SafeAreaProvider>
        )

        const solid = TOP + spacing.xs + GLASS_BUTTON_SIZE
        const height = TOP + CHAT_HEADER_HEIGHT + spacing.lg
        expect(screen.getByTestId(`edge-fade:top:${height}:${solid}`)).toBeOnTheScreen()
    })
})
