// @vitest-environment happy-dom
import { MICROS_PER_CREDIT } from '@rerun/contracts'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { CreditMovement, OrganizationCredit } from '@/ee/services/organization-credit.service'
import type { OrganizationWorkspaceDetail } from '@/ee/services/organization-workspaces.service'

const actions = vi.hoisted(() => Object.fromEntries(
    [
        'listOrganizationWorkspacesAction', 'createOrganizationWorkspaceAction', 'loadOrganizationWorkspaceAction', 'openOrganizationWorkspaceAction', 'archiveOrganizationWorkspaceAction',
        'restoreOrganizationWorkspaceAction', 'restartOrganizationWorkspaceAction', 'deleteOrganizationWorkspaceAction', 'listOrganizationWorkspaceMembersAction', 'inviteOrganizationWorkspaceMemberAction',
        'removeOrganizationWorkspaceMemberAction', 'revokeOrganizationWorkspaceInvitationAction', 'setOrganizationWorkspaceMemberRoleAction', 'loadOrganizationCreditAction', 'allocateOrganizationCreditAction',
        'takeBackOrganizationCreditAction', 'listOrganizationTeamAction', 'inviteOrganizationTeamMemberAction', 'revokeOrganizationTeamInvitationAction', 'setOrganizationTeamRoleAction', 'removeOrganizationTeamMemberAction',
        'loadOrganizationBrandAction', 'updateOrganizationBrandAction', 'listOrganizationDomainsAction', 'addOrganizationDomainAction', 'checkOrganizationDomainAction', 'removeOrganizationDomainAction',
    ].map(name => [name, vi.fn()]),
))
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
const enterActiveWorkspace = vi.hoisted(() => vi.fn())

vi.mock('@/ee/actions/organization.actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/organization' }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/workspace/workspace-switch', () => ({ enterActiveWorkspace, abortWorkspaceSwitch: vi.fn() }))

const { ConsoleProvider } = await import('./ConsoleProvider')
const { WorkspacesScreen } = await import('./WorkspacesScreen')
const { WorkspaceDetailScreen } = await import('./WorkspaceDetailScreen')
const { CreditScreen } = await import('./CreditScreen')
const { TeamScreen } = await import('./TeamScreen')

const ME = '00000000-0000-4000-8000-000000000001'
const LEA = '00000000-0000-4000-8000-000000000002'
const REFUSED = { ok: false as const, error: 'Not enough', code: 'organizationCreditInsufficient' as const }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView ??= () => {}
    for (const action of Object.values(actions)) action.mockReset().mockResolvedValue({ ok: true })
    for (const mock of [...Object.values(router), ...Object.values(toast), enterActiveWorkspace]) mock.mockReset()
    actions.loadOrganizationWorkspaceAction.mockImplementation(async () => ({ ok: true, workspace: workspace() }))
    actions.listOrganizationWorkspacesAction.mockImplementation(async () => ({ ok: true, workspaces: [workspace()], maxWorkspaces: 3 }))
    actions.listOrganizationWorkspaceMembersAction.mockImplementation(async () => ({ ok: true, ...people() }))
    actions.loadOrganizationCreditAction.mockImplementation(async () => ({ ok: true, ...credit() }))
    actions.listOrganizationTeamAction.mockImplementation(async () => ({ ok: true, ...team() }))
    sessionStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    document.body.innerHTML = ''
    vi.useRealTimers()
})

const workspace = (overrides: Partial<OrganizationWorkspaceDetail> = {}): OrganizationWorkspaceDetail => ({ id: 7, name: 'Acme', iconUrl: null, status: 'active', createdAt: '2026-11-01T00:00:00Z', lastActiveAt: null, memberCount: 1, coworkerCount: 0, usedMicros: 0, leftMicros: 50 * MICROS_PER_CREDIT, machine: 'running', locale: 'en', hardware: null, ...overrides })
const people = () => ({
    members: [
        { userId: LEA, email: 'lea@acme.test', role: 'admin' as const, boxScope: 'all' as const },
        { userId: 'jo', email: 'jo@acme.test', role: 'member' as const, boxScope: 'all' as const },
    ],
    invites: [],
})
const movement = (seq: number): CreditMovement => ({ id: String(seq), seq, kind: 'purchase', micros: MICROS_PER_CREDIT, balanceAfter: 0, workspaceId: null, workspaceName: null, actorName: null, note: null, reversed: false, reversalOf: null, createdAt: '2026-11-01T00:00:00Z' })
const credit = (overrides: Partial<OrganizationCredit> = {}): OrganizationCredit => ({ balanceMicros: 1000 * MICROS_PER_CREDIT, movements: [movement(1)], nextBeforeSeq: null, ...overrides })
const team = () => ({
    members: [
        { userId: ME, email: 'me@nordlys.test', name: 'Me', avatarUrl: null, role: 'owner' as const },
        { userId: LEA, email: 'lea@nordlys.test', name: 'Lea', avatarUrl: null, role: 'admin' as const },
    ],
    invitations: [],
})

type Console = { role?: 'owner' | 'admin'; suspended?: boolean }

const inConsole = (node: ReactNode, { role = 'owner', suspended = false }: Console = {}) =>
    act(async () =>
        root.render(
            <TooltipProvider>
                <ConsoleProvider userId={ME} role={role} suspended={suspended}>
                    {node}
                </ConsoleProvider>
            </TooltipProvider>,
        ),
    )

const USAGE = Promise.resolve(null)
const detail = (overrides: Partial<OrganizationWorkspaceDetail> = {}, options: Console = {}) => inConsole(<WorkspaceDetailScreen initial={{ workspace: workspace(overrides) }} initialPeople={people()} initialReserve={{ balanceMicros: 1000 * MICROS_PER_CREDIT }} usage={USAGE} />, options)

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')]
const named = (name: string) => (candidate: HTMLButtonElement) => candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name
const button = (name: string) => buttons().find(named(name))!
const lastButton = (name: string) => buttons().findLast(named(name))!
const click = (element: HTMLElement) => act(async () => element.click())
const submit = () => act(async () => void document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

async function type(selector: string, value: string) {
    const input = document.querySelector<HTMLInputElement>(selector)!
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function held<Answer>() {
    let answer!: (value: Answer) => void
    const promise = new Promise<Answer>(resolve => (answer = resolve))
    return { promise, answer }
}

describe('WorkspacesScreen', () => {
    const list = (options?: Console) => inConsole(<WorkspacesScreen initial={{ workspaces: [workspace()], maxWorkspaces: 3 }} />, options)

    it('creates a workspace, reads the list again, and opens its page', async () => {
        actions.createOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspaceId: 9 })
        actions.listOrganizationWorkspacesAction.mockResolvedValue({ ok: true, workspaces: [workspace(), workspace({ id: 9, name: 'Globex' })], maxWorkspaces: 3 })
        await list()
        await click(button('New workspace'))
        await type('#new-workspace-name', 'Globex')
        await type('#new-workspace-email', 'Hank@Globex.test')
        await submit()

        const form = actions.createOrganizationWorkspaceAction.mock.calls[0][0] as FormData
        expect([form.get('name'), form.get('adminEmail'), form.get('locale'), form.get('logoFile')]).toEqual(['Globex', 'hank@globex.test', 'en', null])
        expect(container.textContent).toContain('2 of 3')
        await click(button('View workspace'))
        expect(router.push).toHaveBeenCalledWith('/organization/workspaces/9')
    })

    it('keeps the form with the reason of a refusal', async () => {
        actions.createOrganizationWorkspaceAction.mockResolvedValue({ ok: false, error: 'x', code: 'organizationWorkspaceLimit', params: { max: 3 } })
        await list()
        await click(button('New workspace'))
        await type('#new-workspace-name', 'Globex')
        await type('#new-workspace-email', 'hank@globex.test')
        await submit()
        expect(document.body.textContent).toContain('You reached your limit of 3 workspaces.')
        expect(document.querySelector<HTMLInputElement>('#new-workspace-name')!.value).toBe('Globex')
    })

    it('creates nothing under a suspended organization', async () => {
        await list({ suspended: true })
        expect(button('New workspace').disabled).toBe(true)
    })
})

describe('WorkspaceDetailScreen', () => {
    it('gives credit once however fast it is clicked, then shows both balances', async () => {
        const allocation = held<{ ok: true }>()
        actions.allocateOrganizationCreditAction.mockReturnValue(allocation.promise)
        await detail()
        await click(button('Add credit'))
        await type('#credit-amount', '20')
        await submit()
        await submit()
        expect(actions.allocateOrganizationCreditAction).toHaveBeenCalledTimes(1)
        expect(actions.allocateOrganizationCreditAction).toHaveBeenCalledWith({ workspaceId: 7, credits: 20, requestId: expect.any(String) })

        actions.loadOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspace: workspace({ leftMicros: 70 * MICROS_PER_CREDIT }) })
        actions.loadOrganizationCreditAction.mockResolvedValue({ ok: true, ...credit({ balanceMicros: 980 * MICROS_PER_CREDIT }) })
        await act(async () => allocation.answer({ ok: true }))
        expect(document.querySelector('form')).toBeNull()
        expect(container.textContent).toContain('70')
        await click(button('Add credit'))
        expect(document.querySelector('form')!.textContent).toContain('980')
    })

    it('sends a refused transfer again under the same request', async () => {
        actions.allocateOrganizationCreditAction.mockResolvedValueOnce(REFUSED)
        await detail()
        await click(button('Add credit'))
        await type('#credit-amount', '20')
        await submit()
        expect(document.querySelector('form')!.textContent).toContain('There is not enough credit left in your balance.')
        await submit()
        const [first, second] = actions.allocateOrganizationCreditAction.mock.calls
        expect(second[0].requestId).toBe(first[0].requestId)
    })

    it('says when less came back than asked', async () => {
        actions.takeBackOrganizationCreditAction.mockResolvedValue({ ok: true, micros: 12 * MICROS_PER_CREDIT })
        await detail()
        await click(button('Take back'))
        await type('#credit-amount', '50')
        await submit()
        expect(toast.info).toHaveBeenCalledWith('Only 12 credits were left to take back')
    })

    it('archives once, and waits for the machine until it is put away', async () => {
        vi.useFakeTimers()
        await detail()
        actions.loadOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspace: workspace({ status: 'archived', machine: 'archiving' }) })
        await click(button('Archive'))
        await click(lastButton('Archive'))
        expect(actions.archiveOrganizationWorkspaceAction).toHaveBeenCalledExactlyOnceWith(7)
        expect(container.textContent).toContain('Archiving')

        actions.loadOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspace: workspace({ status: 'archived', machine: 'archived' }) })
        await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)))
        expect(container.textContent).not.toContain('Archiving')
        expect(button('Restore').disabled).toBe(false)

        const reads = actions.loadOrganizationWorkspaceAction.mock.calls.length
        await act(async () => void (await vi.advanceTimersByTimeAsync(120_000)))
        expect(actions.loadOrganizationWorkspaceAction).toHaveBeenCalledTimes(reads)
    })

    it('stops asking after a while when the job never ends', async () => {
        vi.useFakeTimers()
        actions.loadOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspace: workspace({ machine: 'restoring' }) })
        await detail({ machine: 'restoring' })
        await act(async () => void (await vi.advanceTimersByTimeAsync(24 * 3_600_000)))
        expect(actions.loadOrganizationWorkspaceAction.mock.calls.length).toBeLessThanOrEqual(61)
        expect(actions.loadOrganizationWorkspaceAction.mock.calls.length).toBeGreaterThan(30)
    })

    it('keeps the page when the server cannot be reached', async () => {
        actions.restartOrganizationWorkspaceAction.mockRejectedValue(new TypeError('fetch failed'))
        actions.loadOrganizationWorkspaceAction.mockRejectedValue(new TypeError('fetch failed'))
        await detail()
        await click(button('Restart'))
        await click(lastButton('Restart'))
        expect(toast.error).toHaveBeenCalledTimes(1)
        expect(toast.success).not.toHaveBeenCalled()
        expect(container.textContent).toContain('Acme')
        expect(button('Restart').disabled).toBe(false)
    })

    it('restarts, and says so', async () => {
        await detail()
        await click(button('Restart'))
        await click(lastButton('Restart'))
        expect(toast.success).toHaveBeenCalledWith('The machine is restarting')
    })

    it('opens the workspace once, and stays pending while the app comes', async () => {
        await detail()
        const open = button('Open workspace')
        await click(open)
        await click(open)
        expect(actions.openOrganizationWorkspaceAction).toHaveBeenCalledExactlyOnceWith(7)
        expect(enterActiveWorkspace).toHaveBeenCalledTimes(1)
    })

    it('opens it at the address of its organization when this one does not', async () => {
        const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
        actions.openOrganizationWorkspaceAction.mockResolvedValue({ ok: true, url: 'https://nordlys.rerun.work/?workspace=7' })
        await detail()
        await click(button('Open workspace'))
        expect(assign).toHaveBeenCalledExactlyOnceWith('https://nordlys.rerun.work/?workspace=7')
        expect(enterActiveWorkspace).not.toHaveBeenCalled()
        assign.mockRestore()
    })

    it('stays on a workspace that could not be opened', async () => {
        actions.openOrganizationWorkspaceAction.mockResolvedValue({ ok: false, error: 'x', code: 'organizationSuspended' })
        await detail()
        await click(button('Open workspace'))
        expect(enterActiveWorkspace).not.toHaveBeenCalled()
        expect(toast.error).toHaveBeenCalledTimes(1)
        expect(router.refresh).toHaveBeenCalled()
    })

    it('goes back to the list once deleted', async () => {
        await detail()
        actions.loadOrganizationWorkspaceAction.mockClear()
        await click(button('Delete'))
        await type('input[aria-label="Acme"]', 'Acme')
        await click(lastButton('Delete'))
        expect(actions.deleteOrganizationWorkspaceAction).toHaveBeenCalledExactlyOnceWith(7)
        expect(router.push).toHaveBeenCalledWith('/organization')
        expect(toast.success).toHaveBeenCalledWith('Acme was deleted')
        expect(actions.loadOrganizationWorkspaceAction).not.toHaveBeenCalled()
    })

    it('loads the console afresh when the tab was on the workspace it deletes', async () => {
        const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
        sessionStorage.setItem('rerun:tab-workspace', '7')
        await detail()
        await click(button('Delete'))
        await type('input[aria-label="Acme"]', 'Acme')
        await click(lastButton('Delete'))
        expect(assign).toHaveBeenCalledWith('/organization')
        expect(sessionStorage.getItem('rerun:tab-workspace')).toBeNull()
        assign.mockRestore()
    })

    it('stays on a workspace whose machine would not go', async () => {
        actions.deleteOrganizationWorkspaceAction.mockResolvedValue({ ok: false, error: 'x', code: 'workspaceMachineBusy' })
        await detail()
        await click(button('Delete'))
        await type('input[aria-label="Acme"]', 'Acme')
        await click(lastButton('Delete'))
        expect(router.push).not.toHaveBeenCalled()
        expect(toast.error).toHaveBeenCalledTimes(1)
        expect(actions.loadOrganizationWorkspaceAction).toHaveBeenCalled()
    })

    it('takes a removed person off at once, and puts them back when refused', async () => {
        const removal = held<unknown>()
        actions.removeOrganizationWorkspaceMemberAction.mockReturnValue(removal.promise)
        await detail()
        await click(button('Remove jo@acme.test'))
        await click(lastButton('Remove'))
        expect(container.textContent).not.toContain('jo@acme.test')
        await act(async () => removal.answer({ ok: false, error: 'x', code: 'generic' }))
        expect(container.textContent).toContain('jo@acme.test')
        expect(toast.error).toHaveBeenCalledTimes(1)
    })

    it('asks the server for its page again when the workspace is no longer theirs', async () => {
        actions.loadOrganizationWorkspaceAction.mockResolvedValue({ ok: false, error: 'x', code: 'workspaceNotFound' })
        actions.restoreOrganizationWorkspaceAction.mockResolvedValue({ ok: false, error: 'x', code: 'workspaceNotFound' })
        await detail({ status: 'archived', machine: 'archived' })
        await click(button('Restore'))
        expect(router.refresh).toHaveBeenCalled()
        expect(toast.error).toHaveBeenCalledWith('Workspace not found')
    })

    it('says the usage could not be read', async () => {
        await detail()
        expect(container.textContent).toMatch(/could not|failed/i)
    })
})

describe('CreditScreen', () => {
    it('shows older movements under the ones it has, and keeps them after a transfer', async () => {
        let latest = [movement(60), movement(59)]
        actions.loadOrganizationCreditAction.mockImplementation(async (before?: number) => ({ ok: true, ...credit(before ? { movements: [movement(58)], nextBeforeSeq: null } : { movements: latest, nextBeforeSeq: 59 }) }))
        await inConsole(<CreditScreen initial={credit({ movements: latest, nextBeforeSeq: 59 })} initialWorkspaces={{ workspaces: [workspace()] }} />)
        await click(button('Show more'))
        expect(actions.loadOrganizationCreditAction).toHaveBeenLastCalledWith(59)
        expect(container.querySelectorAll('time')).toHaveLength(3)
        expect(button('Show more')).toBeUndefined()

        latest = [movement(61), movement(60)]
        await act(async () => {
            vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)
            document.dispatchEvent(new Event('visibilitychange'))
        })
        vi.restoreAllMocks()
        expect(container.querySelectorAll('time')).toHaveLength(4)
        expect(button('Show more')).toBeUndefined()
    })
})

describe('TeamScreen', () => {
    const render = (options?: Console) => inConsole(<TeamScreen initial={team()} />, options)

    it('takes someone off at once, and puts them back when refused', async () => {
        const removal = held<unknown>()
        actions.removeOrganizationTeamMemberAction.mockReturnValue(removal.promise)
        await render()
        await click(button('Remove Lea'))
        await click(lastButton('Remove'))
        expect(actions.removeOrganizationTeamMemberAction).toHaveBeenCalledWith(LEA)
        expect(container.textContent).not.toContain('lea@nordlys.test')
        await act(async () => removal.answer({ ok: false, error: 'x', code: 'organizationOwnerOnly' }))
        expect(container.textContent).toContain('lea@nordlys.test')
        expect(router.refresh).toHaveBeenCalled()
    })

    it('hands over the link of an invitation, and shows it in the list', async () => {
        actions.inviteOrganizationTeamMemberAction.mockResolvedValue({ ok: true, inviteUrl: 'https://app.test/organization/invite/tok' })
        actions.listOrganizationTeamAction.mockResolvedValue({ ok: true, ...team(), invitations: [{ id: 'i', email: 'new@nordlys.test', role: 'admin', createdAt: '', expiresAt: '' }] })
        await render()
        await click(button('Invite'))
        await type('#invite-email', 'new@nordlys.test')
        await submit()
        expect(document.body.textContent).toContain('https://app.test/organization/invite/tok')
        expect(container.textContent).toContain('new@nordlys.test')
    })

    it('is an owner’s to change', async () => {
        await render({ role: 'admin' })
        for (const name of ['Invite', 'Remove Lea', 'Role of Lea']) expect(button(name).disabled, name).toBe(true)
    })
})
