// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceInviteRow } from '@/app/api/_actions/members.actions'

import { WorkspaceInviteRowView } from './WorkspaceMemberRow'

// The revoke button of a pending invitation sits inside the trigger of its confirmation. It used to
// drop the click the trigger handed it, so revoking an invitation did nothing at all.

const invite: WorkspaceInviteRow = { id: 'invite-1', email: 'teammate@example.com', status: 'pending', createdAt: '2026-11-11T00:00:00Z', boxScope: 'all' }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const revokeButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Revoke invitation"]')
const confirmation = () => document.querySelector('[role="alertdialog"]')

describe('WorkspaceInviteRowView', () => {
    it('asks for a confirmation, then revokes the invitation', async () => {
        const onRevoke = vi.fn()
        act(() => root.render(createElement(WorkspaceInviteRowView, { invite, viewerIsAdmin: true, onRevoke })))

        await act(async () => revokeButton()!.click())
        expect(confirmation(), 'the click opens the confirmation').not.toBeNull()
        expect(confirmation()!.textContent).toContain('Revoke the invitation to teammate@example.com?')
        expect(onRevoke).not.toHaveBeenCalled()

        const confirm = [...confirmation()!.querySelectorAll('button')].find((button) => button.textContent === 'Revoke')!
        await act(async () => confirm.click())
        expect(onRevoke).toHaveBeenCalledTimes(1)
    })

    it('leaves the invitation alone when the confirmation is cancelled', async () => {
        const onRevoke = vi.fn()
        act(() => root.render(createElement(WorkspaceInviteRowView, { invite, viewerIsAdmin: true, onRevoke })))

        await act(async () => revokeButton()!.click())
        const cancel = [...confirmation()!.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!
        await act(async () => cancel.click())
        expect(confirmation()).toBeNull()
        expect(onRevoke).not.toHaveBeenCalled()
    })

    it('shows a disabled button to a member who is not an admin', () => {
        act(() => root.render(createElement(WorkspaceInviteRowView, { invite, viewerIsAdmin: false, onRevoke: vi.fn() })))

        expect(revokeButton()?.disabled).toBe(true)
    })
})
