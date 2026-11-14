import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { createRef, type Ref } from 'react'

import { Composer, type ComposerHandle } from './Composer'

jest.mock('@/lib/haptics', () => ({ selectionAsync: jest.fn(), impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' } }))
jest.mock('@/components/ui/GlassSurface', () => {
    const React = require('react')
    const { View } = require('react-native')
    return { GlassSurface: ({ children }: { children: unknown }) => React.createElement(View, null, children) }
})
jest.mock('@/components/ui/GlassButton', () => ({ useGlassStyle: () => undefined }))
jest.mock('@/components/ui/NativeMenu', () => {
    const React = require('react')
    const { View } = require('react-native')
    return {
        NativeMenu: ({ trigger }: { trigger: unknown }) => React.createElement(View, null, trigger),
        MenuItem: () => null,
        MenuToggle: () => null,
        MenuSection: ({ children }: { children: unknown }) => children,
        SubMenu: ({ children }: { children: unknown }) => children,
    }
})
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn(async () => ({ canceled: true })) }))
jest.mock('expo-image-picker', () => ({
    launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
    launchCameraAsync: jest.fn(async () => ({ canceled: true })),
    requestCameraPermissionsAsync: jest.fn(async () => ({ granted: false })),
    UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}))

const noop = () => {}

function composer(draftKey: string, ref?: Ref<ComposerHandle>) {
    return <Composer ref={ref} draftKey={draftKey} onSend={noop} onStop={noop} running={false} placeholder="Message Pulse" canAttach={false} />
}

const input = () => screen.getByTestId('composer-input')

describe('Composer drafts', () => {
    it('restores a message into an empty composer, and leaves text already typed alone', async () => {
        const ref = createRef<ComposerHandle>()
        await render(composer('restore', ref))

        let restored = false
        await act(async () => {
            restored = ref.current!.restore('Send the deck')
        })
        expect(restored).toBe(true)
        expect(input().props.value).toBe('Send the deck')

        await act(async () => {
            restored = ref.current!.restore('Something else')
        })
        expect(restored).toBe(false)
        expect(input().props.value).toBe('Send the deck')
    })

    it('keeps the draft while a widget takes the composer away and brings it back', async () => {
        const view = await render(composer('unmount'))
        await fireEvent.changeText(input(), 'Half a thought')
        await view.unmount()

        await render(composer('unmount'))
        expect(input().props.value).toBe('Half a thought')
    })

    it("shows each conversation's own draft", async () => {
        const view = await render(composer('first'))
        await fireEvent.changeText(input(), 'For the first')

        await view.rerender(composer('second'))
        expect(input().props.value).toBe('')
        await fireEvent.changeText(input(), 'For the second')

        await view.rerender(composer('first'))
        expect(input().props.value).toBe('For the first')
    })
})
