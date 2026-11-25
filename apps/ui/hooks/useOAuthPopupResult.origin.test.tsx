// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import { useOAuthPopupResult } from './useOAuthPopupResult'

function Listener({ onResult }: { onResult: (data: unknown) => void }) {
    useOAuthPopupResult('managed-oauth', ['managed-oauth-success'], onResult)
    return null
}

it('hears the popup of its own origin, and no other window', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const onResult = vi.fn()
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(createElement(Listener, { onResult })))

    const message = { type: 'managed-oauth-success', key: 'gmail' }
    await act(async () => void window.dispatchEvent(new MessageEvent('message', { data: message, origin: 'https://evil.example' })))
    expect(onResult).not.toHaveBeenCalled()
    await act(async () => void window.dispatchEvent(new MessageEvent('message', { data: message, origin: window.location.origin })))
    expect(onResult).toHaveBeenCalledExactlyOnceWith(message)
    act(() => root.unmount())
})
