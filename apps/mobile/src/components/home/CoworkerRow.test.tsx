import { render, screen } from '@testing-library/react-native'

import { CoworkerRow } from '@/components/home/CoworkerRow'

// The swipe itself needs the native gesture handler: drawn here as the row beside its action.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
    const { forwardRef } = jest.requireActual('react')
    const { View } = jest.requireActual('react-native')
    return forwardRef(({ children, renderRightActions }: { children: React.ReactNode; renderRightActions: () => React.ReactNode }, _ref: unknown) => (
        <View>
            {children}
            {renderRightActions()}
        </View>
    ))
})

describe('CoworkerRow', () => {
    it("keeps the swipe's pin action away from TalkBack and VoiceOver: the row is reached by its swipe", async () => {
        await render(<CoworkerRow coworker={{ id: 'scout', kind: 'coworker', name: 'Scout', status: 'idle' }} line={{ text: 'Sent 3 leads', tone: 'muted' }} minutesAgo={5} unread={false} onPress={() => {}} pin={{ pinned: false, onToggle: () => {} }} />)
        const action = screen.getByText('Pin', { includeHiddenElements: true })
        const hidden = (node: typeof action | null): typeof action | null => (!node ? null : node.props.accessibilityElementsHidden ? node : hidden(node.parent))
        expect(hidden(action)?.props.importantForAccessibility).toBe('no-hide-descendants')
    })
})
