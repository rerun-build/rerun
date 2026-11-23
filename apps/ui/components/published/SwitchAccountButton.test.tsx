// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const signOut = vi.hoisted(() => vi.fn())

vi.mock('@/supabase/client', () => ({ createClient: () => ({ auth: { signOut } }) }))

const { SwitchAccountButton } = await import('./SwitchAccountButton')

let container: HTMLDivElement
let root: Root
let visited: string[]

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    signOut.mockReset().mockResolvedValue({ error: null })
    visited = []
    vi.spyOn(window.location, 'href', 'set').mockImplementation(url => void visited.push(url))
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
})

describe('SwitchAccountButton', () => {
    it('signs out of this browser only, then comes back to the published page', async () => {
        await act(async () => root.render(createElement(SwitchAccountButton, { returnTo: '/p/report' })))
        await act(async () => container.querySelector('button')?.click())

        expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
        expect(visited).toEqual(['/auth?next=%2Fp%2Freport'])
    })
})
