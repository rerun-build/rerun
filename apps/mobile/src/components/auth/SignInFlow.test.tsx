import { fireEvent, render, screen } from '@testing-library/react-native'
import { Pressable, Text } from 'react-native'

import { SignInFlowProvider, useSignInFlow } from '@/components/auth/SignInFlow'

function CurrentStep() {
    const { step, goTo, back, canGoBack } = useSignInFlow()
    return (
        <>
            <Pressable accessibilityRole="button" accessibilityLabel="forward" onPress={() => goTo({ name: 'email' })}>
                <Text>{step.name}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="back" onPress={back}>
                <Text>{canGoBack ? 'can go back' : 'first step'}</Text>
            </Pressable>
        </>
    )
}

describe('SignInFlowProvider', () => {
    it('only offers a way back once a step was pushed, and walks it back', async () => {
        await render(
            <SignInFlowProvider>
                <CurrentStep />
            </SignInFlowProvider>
        )
        expect(screen.getByText('first step')).toBeTruthy()

        await fireEvent.press(screen.getByLabelText('forward'))
        expect(screen.getByText('email')).toBeTruthy()
        expect(screen.getByText('can go back')).toBeTruthy()

        await fireEvent.press(screen.getByLabelText('back'))
        expect(screen.getByText('start')).toBeTruthy()
        expect(screen.getByText('first step')).toBeTruthy()
    })
})
