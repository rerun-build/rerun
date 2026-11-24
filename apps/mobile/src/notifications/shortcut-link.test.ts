import { act, renderHook } from '@testing-library/react-native'

import { redirectSystemPath } from '@/app/+native-intent'

import { forgetShortcut, usePendingShortcut } from './shortcut-link'

async function held(path: string) {
    const routed = redirectSystemPath({ path, initial: false })
    const { result, unmount } = await renderHook(() => usePendingShortcut())
    const target = result.current
    await act(() => {
        if (target) forgetShortcut(target.id)
    })
    unmount()
    return { routed, target }
}

describe('a coworker shortcut', () => {
    it.each(['rerun://chat/general?to=agent-1&workspace=7', '/chat/general?to=agent-1&workspace=7'])('waits for its workspace instead of being routed: %s', async path => {
        const { routed, target } = await held(path)
        expect(routed).toBeNull()
        expect(target).toMatchObject({ workspaceId: 7, href: { pathname: '/chat/[id]', params: { id: 'general', to: 'agent-1' } } })
    })

    it('opens the last conversation of the Chief of Staff', async () => {
        const { routed, target } = await held('rerun://chat/last?workspace=7')
        expect(routed).toBeNull()
        expect(target).toMatchObject({ workspaceId: 7, href: { pathname: '/chat/[id]', params: { id: 'last' } } })
    })

    it.each([
        'rerun://chat/general?to=agent-1',
        'rerun://chat/last',
        'rerun://chat/conv-1?to=agent-1',
        'rerun://chat/last?workspace=',
        'rerun://chat/last?workspace=0',
        'rerun://chat/last?workspace=7abc',
        'rerun://chat/general?workspace=7',
        'rerun://chat/general?to=..%2Fsettings&workspace=7',
        'rerun://coworker/general?to=agent-1&workspace=7',
        '/lab-icons',
    ])('leaves any other link to the router: %s', async path => {
        const { routed, target } = await held(path)
        expect(routed).toBe(path)
        expect(target).toBeNull()
    })

    it('still keeps an OAuth redirect from the router', async () => {
        const { routed, target } = await held('rerun://auth/callback?code=abc')
        expect(routed).toBeNull()
        expect(target).toBeNull()
    })

    it('forgets only the shortcut it is told about, so a later tap is not lost to an earlier one', async () => {
        redirectSystemPath({ path: 'rerun://chat/last?workspace=7', initial: false })
        const { result, unmount } = await renderHook(() => usePendingShortcut())
        const first = result.current!
        await act(() => void redirectSystemPath({ path: 'rerun://chat/last?workspace=8', initial: false }))
        await act(() => forgetShortcut(first.id))
        expect(result.current).toMatchObject({ workspaceId: 8 })
        await act(() => forgetShortcut(result.current!.id))
        expect(result.current).toBeNull()
        unmount()
    })
})
