// @vitest-environment happy-dom
import { MICROS_PER_CREDIT, RERUN_BRAND } from '@rerun/contracts'
import { act, Suspense, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { CreditMovement, OrganizationCredit } from '@/ee/services/organization-credit.service'
import type { OrganizationWorkspaceDetail } from '@/ee/services/organization-workspaces.service'

const actions = vi.hoisted(() => Object.fromEntries(
    [
        'loadOrganizationOverviewAction', 'resendOrganizationWorkspaceInvitationAction', 'readOrganizationWorkspaceInvitationUrlAction', 'createOrganizationWorkspaceAction', 'loadOrganizationWorkspaceAction', 'openOrganizationWorkspaceAction', 'archiveOrganizationWorkspaceAction',
        'restoreOrganizationWorkspaceAction', 'restartOrganizationWorkspaceAction', 'deleteOrganizationWorkspaceAction', 'listOrganizationWorkspaceMembersAction', 'inviteOrganizationWorkspaceMemberAction',
        'removeOrganizationWorkspaceMemberAction', 'revokeOrganizationWorkspaceInvitationAction', 'setOrganizationWorkspaceMemberRoleAction', 'loadOrganizationCreditAction', 'allocateOrganizationCreditAction',
        'takeBackOrganizationCreditAction', 'listOrganizationTeamAction', 'inviteOrganizationTeamMemberAction', 'revokeOrganizationTeamInvitationAction', 'setOrganizationTeamRoleAction', 'removeOrganizationTeamMemberAction',
        'loadOrganizationBrandAction', 'updateOrganizationBrandAction', 'listOrganizationDomainsAction', 'addOrganizationDomainAction', 'checkOrganizationDomainAction', 'removeOrganizationDomainAction',
    ].map(name => [name, vi.fn()]),
))
const place = vi.hoisted(() => ({ pathname: '/organization' }))
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
const enterActiveWorkspace = vi.hoisted(() => vi.fn())

vi.mock('@/ee/actions/organization.actions', () => actions)
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => place.pathname }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/workspace/workspace-switch', () => ({ enterActiveWorkspace, abortWorkspaceSwitch: vi.fn() }))

const { ConsoleLoading } = await import('./ConsoleFrame')
const { ConsoleProvider } = await import('./ConsoleProvider')
const { NewWorkspaceScreen } = await import('./NewWorkspaceScreen')
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
    actions.loadOrganizationOverviewAction.mockImplementation(async () => ({ ok: true, ...overview() }))
    actions.listOrganizationWorkspaceMembersAction.mockImplementation(async () => ({ ok: true, ...people() }))
    actions.loadOrganizationCreditAction.mockImplementation(async () => ({ ok: true, ...credit() }))
    actions.listOrganizationTeamAction.mockImplementation(async () => ({ ok: true, ...team() }))
    place.pathname = '/organization'
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

const workspace = (overrides: Partial<OrganizationWorkspaceDetail> = {}): OrganizationWorkspaceDetail => ({ id: 7, name: 'Acme', iconUrl: null, status: 'active', createdAt: '2026-11-01T00:00:00Z', lastActiveAt: null, memberCount: 1, coworkerCount: 1, coworkers: [{ id: 'c1', name: 'Nova', look: null, status: 'idle' }], pendingAdmin: null, spentPerDayMicros: 0, diskPercent: null, usedMicros: 0, leftMicros: 50 * MICROS_PER_CREDIT, machine: 'running', locale: 'en', hardware: null, ...overrides })
const overview = (workspaces = [workspace()], reserve = 1000) => ({ workspaces, maxWorkspaces: 3, reserveMicros: reserve * MICROS_PER_CREDIT })
const people = () => ({
    members: [
        { userId: LEA, email: 'lea@acme.test', name: null, role: 'admin' as const, boxScope: 'all' as const },
        { userId: 'jo', email: 'jo@acme.test', name: null, role: 'member' as const, boxScope: 'all' as const },
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

type Console = { role?: 'owner' | 'admin'; suspended?: boolean; shown?: ReturnType<typeof overview> }

const inConsole = (node: ReactNode, { role = 'owner', suspended = false, shown = overview() }: Console = {}) => {
    const read = Promise.resolve(shown)
    actions.loadOrganizationOverviewAction.mockResolvedValue({ ok: true, ...shown })
    return act(async () =>
        root.render(
            <TooltipProvider>
                <Suspense>
                    <ConsoleProvider userId={ME} role={role} suspended={suspended} viewer={{ name: 'Me', email: null, photo: null }} brand={{ ...RERUN_BRAND, organizationId: 'o1', name: 'Nordlys' }} overview={read}>
                        {node}
                    </ConsoleProvider>
                </Suspense>
            </TooltipProvider>,
        ),
    )
}

const USAGE = Promise.resolve(null)
const detail = (overrides: Partial<OrganizationWorkspaceDetail> = {}, options: Console = {}) => inConsole(<WorkspaceDetailScreen initial={{ workspace: workspace(overrides) }} initialPeople={people()} usage={USAGE} />, options)

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

async function pick(name: string, trigger = 'More') {
    await act(async () => void button(trigger).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await click([...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === name)!)
}

function held<Answer>() {
    let answer!: (value: Answer) => void
    const promise = new Promise<Answer>(resolve => (answer = resolve))
    return { promise, answer }
}

describe('ConsoleLoading', () => {
    const load = (pathname: string) => {
        place.pathname = pathname
        return act(async () => root.render(<ConsoleLoading organization={{ name: 'Nordlys', iconUrl: null }} hosted />))
    }

    it.each([
        ['/organization', 'h1', 'Workspaces'],
        ['/organization/credit', 'h1', 'Credit'],
        ['/organization/brand', 'h1', 'Brand'],
        ['/organization/domains', 'main', 'Included'],
        ['/organization/team', 'h1', 'Team'],
        ['/organization/workspaces/7', 'main', 'People'],
    ])('draws the page of %s under the bar', async (pathname, selector, text) => {
        await load(pathname)
        expect(container.querySelector('nav')).not.toBeNull()
        expect(container.querySelector(selector)!.textContent).toContain(text)
        expect(container.querySelector('main [data-slot="skeleton"]')).not.toBeNull()
    })

    it('shows no bar on the way to a new workspace', async () => {
        await load('/organization/workspaces/new')
        expect(container.querySelector('nav')).toBeNull()
        expect(container.querySelector('h1')!.textContent).toBe('Who is it for?')
    })
})

describe('WorkspacesScreen', () => {
    const invited = workspace({ memberCount: 0, machine: 'none', pendingAdmin: { invitationId: LEA, email: 'lea@acme.test', expired: false } })

    it('sends an invitation again, and says to whom', async () => {
        await inConsole(<WorkspacesScreen setup={null} />, { shown: overview([invited]) })
        await click(button('Resend invite'))
        expect(actions.resendOrganizationWorkspaceInvitationAction).toHaveBeenCalledExactlyOnceWith(7, LEA)
        expect(toast.success).toHaveBeenCalledWith('Invitation sent to lea@acme.test')
        expect(actions.loadOrganizationOverviewAction).toHaveBeenCalled()
    })

    it('gives credit to one that is out of it, then reads the console again', async () => {
        await inConsole(<WorkspacesScreen setup={null} />, { shown: overview([workspace({ leftMicros: 0 })]) })
        await click(button('Add credit'))
        await type('#credit-amount', '20')
        actions.loadOrganizationOverviewAction.mockResolvedValue({ ok: true, ...overview() })
        await submit()
        expect(actions.allocateOrganizationCreditAction).toHaveBeenCalledExactlyOnceWith({ workspaceId: 7, credits: 20, requestId: expect.any(String) })
        expect(container.textContent).toContain('50 credits, Unused')
        expect(document.querySelector('form')).toBeNull()
    })

    it('walks an agency with no client through what is left to do', async () => {
        await inConsole(<WorkspacesScreen setup={{ brand: true, domain: null, team: false }} />, { shown: overview([]) })
        expect(container.textContent).toContain('Nordlys is almost open.')
        expect([...container.querySelectorAll('ol a')].map(link => link.getAttribute('href'))).toEqual(['/organization/brand', '/organization/workspaces/new', '/organization/team'])
    })
})

describe('NewWorkspaceScreen', () => {
    const create = async (options?: Console) => {
        await inConsole(<NewWorkspaceScreen email="" />, options)
        await type('#new-workspace-name', 'Globex')
        await type('#new-workspace-email', 'Hank@Globex.test')
        await submit()
    }

    it('creates a workspace with its credit, and reads the console again', async () => {
        actions.createOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspaceId: 9 })
        await create()
        const [form, starting] = actions.createOrganizationWorkspaceAction.mock.calls[0] as [FormData, unknown]
        expect([form.get('name'), form.get('adminEmail'), form.get('locale'), form.get('logoFile')]).toEqual(['Globex', 'hank@globex.test', 'en', null])
        expect(starting).toEqual({ credits: 500, requestId: expect.any(String) })
        expect(actions.loadOrganizationOverviewAction).toHaveBeenCalled()
        expect(container.querySelector('a[href="/organization/workspaces/9"]')).not.toBeNull()
    })

    it('keeps the form with the reason of a refusal', async () => {
        actions.createOrganizationWorkspaceAction.mockResolvedValue({ ok: false, error: 'x', code: 'organizationWorkspaceLimit', params: { max: 3 } })
        await create()
        expect(document.body.textContent).toContain('You reached your limit of 3 workspaces.')
        expect(document.querySelector<HTMLInputElement>('#new-workspace-name')!.value).toBe('Globex')
    })

    it('creates nothing under a suspended organization', async () => {
        await create({ suspended: true })
        expect(actions.createOrganizationWorkspaceAction).not.toHaveBeenCalled()
    })
})

describe('WorkspaceDetailScreen', () => {
    it('gives credit once however fast it is clicked, then shows both balances', async () => {
        const allocation = held<{ ok: true }>()
        actions.allocateOrganizationCreditAction.mockReturnValue(allocation.promise)
        await detail()
        await type('#workspace-credit-amount', '20')
        await submit()
        await submit()
        expect(actions.allocateOrganizationCreditAction).toHaveBeenCalledTimes(1)
        expect(actions.allocateOrganizationCreditAction).toHaveBeenCalledWith({ workspaceId: 7, credits: 20, requestId: expect.any(String) })

        actions.loadOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspace: workspace({ leftMicros: 70 * MICROS_PER_CREDIT }) })
        actions.loadOrganizationOverviewAction.mockResolvedValue({ ok: true, ...overview([workspace()], 980) })
        await act(async () => allocation.answer({ ok: true }))
        expect(document.querySelector<HTMLInputElement>('#workspace-credit-amount')!.value).toBe('')
        expect(container.textContent).toContain('70')
        expect(container.textContent).toContain('980 in reserve')
    })

    it('sends a refused transfer again under the same request', async () => {
        actions.allocateOrganizationCreditAction.mockResolvedValueOnce(REFUSED)
        await detail()
        await type('#workspace-credit-amount', '20')
        await submit()
        expect(container.textContent).toContain('There is not enough credit left in your balance.')
        await submit()
        const [first, second] = actions.allocateOrganizationCreditAction.mock.calls
        expect(second[0].requestId).toBe(first[0].requestId)
    })

    it('sends the invitation again, and copies its link', async () => {
        const write = vi.fn<(items: unknown) => Promise<void>>(async () => {})
        vi.stubGlobal('ClipboardItem', class { constructor(readonly parts: Record<string, Promise<Blob>>) {} })
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
        actions.readOrganizationWorkspaceInvitationUrlAction.mockResolvedValue({ ok: true, inviteUrl: 'https://x.test/invite/abc' })
        const waiting = { memberCount: 0, coworkerCount: 0, coworkers: [], machine: 'none' as const, pendingAdmin: { invitationId: LEA, email: 'lea@acme.test', expired: true } }
        actions.loadOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspace: workspace(waiting) })
        await detail(waiting)
        expect(container.textContent).toContain('The invitation of lea@acme.test expired')
        await click(button('Copy link'))
        const [[copied]] = write.mock.calls as [[[{ parts: Record<string, Promise<Blob>> }]]]
        expect(await (await copied[0].parts['text/plain']).text()).toBe('https://x.test/invite/abc')
        expect(toast.success).toHaveBeenCalledWith('Link copied')
        vi.unstubAllGlobals()
    })

    it.each([
        ['the link is refused', { ok: false, code: 'invitationNotFound' }, 'Invitation not found'],
        ['the browser refuses to copy', { ok: true, inviteUrl: 'https://x.test/invite/abc' }, 'Something went wrong. Please try again.'],
    ])('copies nothing when %s, and says it', async (_, answer, told) => {
        const written: string[] = []
        vi.stubGlobal('ClipboardItem', class { constructor(readonly parts: Record<string, Promise<Blob>>) {} })
        const write = async ([item]: [{ parts: Record<string, Promise<Blob>> }]) => {
            const blob = await item.parts['text/plain']
            if (answer.ok) throw new Error('not allowed')
            written.push(await blob.text())
        }
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } })
        actions.readOrganizationWorkspaceInvitationUrlAction.mockResolvedValue(answer)
        const waiting = { memberCount: 0, coworkerCount: 0, coworkers: [], machine: 'none' as const, pendingAdmin: { invitationId: LEA, email: 'lea@acme.test', expired: false } }
        actions.loadOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspace: workspace(waiting) })
        await detail(waiting)
        await click(button('Copy link'))
        expect(written).toEqual([])
        expect(toast.success).not.toHaveBeenCalled()
        expect(toast.error).toHaveBeenCalledExactlyOnceWith(told)
        vi.unstubAllGlobals()
    })

    it('says when less came back than asked', async () => {
        actions.takeBackOrganizationCreditAction.mockResolvedValue({ ok: true, micros: 12 * MICROS_PER_CREDIT })
        await detail()
        await pick('Take back')
        expect(document.querySelectorAll('#credit-amount')).toHaveLength(1)
        await type('[role="dialog"] #credit-amount', '50')
        await act(async () => void document.querySelector('[role="dialog"] form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
        expect(toast.info).toHaveBeenCalledWith('Only 12 credits were left to take back')
    })

    it('archives once, and waits for the machine until it is put away', async () => {
        vi.useFakeTimers()
        await detail()
        actions.loadOrganizationWorkspaceAction.mockResolvedValue({ ok: true, workspace: workspace({ status: 'archived', machine: 'archiving' }) })
        await pick('Archive')
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
        await pick('Restart')
        await click(lastButton('Restart'))
        expect(toast.error).toHaveBeenCalledTimes(1)
        expect(toast.success).not.toHaveBeenCalled()
        expect(container.textContent).toContain('Acme')
    })

    it('restarts, and says so', async () => {
        await detail()
        await pick('Restart')
        await click(lastButton('Restart'))
        expect(toast.success).toHaveBeenCalledWith('The machine is restarting')
    })

    it('opens the workspace once, and stays pending while the app comes', async () => {
        await detail()
        const open = button('Open')
        await click(open)
        await click(open)
        expect(actions.openOrganizationWorkspaceAction).toHaveBeenCalledExactlyOnceWith(7)
        expect(enterActiveWorkspace).toHaveBeenCalledTimes(1)
    })

    it('opens it at the address of its organization when this one does not', async () => {
        const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
        actions.openOrganizationWorkspaceAction.mockResolvedValue({ ok: true, url: 'https://nordlys.rerun.work/?workspace=7' })
        await detail()
        await click(button('Open'))
        expect(assign).toHaveBeenCalledExactlyOnceWith('https://nordlys.rerun.work/?workspace=7')
        expect(enterActiveWorkspace).not.toHaveBeenCalled()
        assign.mockRestore()
    })

    it('stays on a workspace that could not be opened', async () => {
        actions.openOrganizationWorkspaceAction.mockResolvedValue({ ok: false, error: 'x', code: 'organizationSuspended' })
        await detail()
        await click(button('Open'))
        expect(enterActiveWorkspace).not.toHaveBeenCalled()
        expect(toast.error).toHaveBeenCalledTimes(1)
        expect(router.refresh).toHaveBeenCalled()
    })

    it('goes back to the list once deleted', async () => {
        await detail()
        actions.loadOrganizationWorkspaceAction.mockClear()
        await pick('Delete')
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
        await pick('Delete')
        await type('input[aria-label="Acme"]', 'Acme')
        await click(lastButton('Delete'))
        expect(assign).toHaveBeenCalledWith('/organization')
        expect(sessionStorage.getItem('rerun:tab-workspace')).toBeNull()
        assign.mockRestore()
    })

    it('stays on a workspace whose machine would not go', async () => {
        actions.deleteOrganizationWorkspaceAction.mockResolvedValue({ ok: false, error: 'x', code: 'workspaceMachineBusy' })
        await detail()
        await pick('Delete')
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
        await inConsole(<CreditScreen initial={credit({ movements: latest, nextBeforeSeq: 59 })} />)
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

describe('CreditScreen, several at once', () => {
    it('gives one after the other, reads the page once, and says which did not go through', async () => {
        const clients = [workspace(), workspace({ id: 8, name: 'Globex' })]
        actions.allocateOrganizationCreditAction.mockImplementation(async ({ workspaceId }: { workspaceId: number }) => (workspaceId === 8 ? REFUSED : { ok: true }))
        actions.loadOrganizationOverviewAction.mockResolvedValue({ ok: true, ...overview(clients) })
        await inConsole(<CreditScreen initial={credit()} />, { shown: overview(clients) })
        await type('input[aria-label="Credit for Acme"]', '10')
        await type('input[aria-label="Credit for Globex"]', '20')
        actions.loadOrganizationCreditAction.mockClear()
        await submit()
        expect(actions.allocateOrganizationCreditAction.mock.calls.map(([{ workspaceId, credits }]) => [workspaceId, credits])).toEqual([[7, 10], [8, 20]])
        expect(actions.loadOrganizationCreditAction).toHaveBeenCalledTimes(1)
        expect(container.querySelector('form')!.textContent).toContain('There is not enough credit left in your balance.')
        expect(document.querySelector<HTMLInputElement>('input[aria-label="Credit for Acme"]')!.value).toBe('')
        expect(document.querySelector<HTMLInputElement>('input[aria-label="Credit for Globex"]')!.value).toBe('20')
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
