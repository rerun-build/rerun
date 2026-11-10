import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { BackHandler, Pressable, Text } from 'react-native'

import { SignInFlowProvider, useSignInFlow } from '@/components/auth/SignInFlow'

function CurrentStep() {
    const { step, goTo } = useSignInFlow()
    return (
        <Pressable accessibilityRole="button" onPress={() => goTo({ name: 'email' })}>
            <Text>{step.name}</Text>
        </Pressable>
    )
}

describe('SignInFlowProvider and the system back', () => {
    type BackListener = Parameters<typeof BackHandler.addEventListener>[1]
    let handlers: BackListener[]

    beforeEach(() => {
        handlers = []
        jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
            handlers.push(handler)
            return { remove: () => (handlers = handlers.filter(registered => registered !== handler)) }
        })
    })

    afterEach(() => jest.restoreAllMocks())

    const pressBack = () => handlers.toReversed().some(handler => handler({} as Parameters<BackListener>[0]))

    it('goes back one step instead of leaving the app', async () => {
        await render(
            <SignInFlowProvider>
                <CurrentStep />
            </SignInFlowProvider>
        )
        await fireEvent.press(screen.getByRole('button'))
        expect(screen.getByText('email')).toBeTruthy()

        let handled = false
        await act(async () => {
            handled = pressBack()
        })
        expect(handled).toBe(true)
        expect(screen.getByText('start')).toBeTruthy()
    })

    it('lets the system handle back on the first step', async () => {
        await render(
            <SignInFlowProvider>
                <CurrentStep />
            </SignInFlowProvider>
        )
        expect(pressBack()).toBe(false)
    })
})
