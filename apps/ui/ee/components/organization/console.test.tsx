// @vitest-environment happy-dom
import { MICROS_PER_CREDIT, RERUN_BRAND, type Brand } from '@rerun/contracts'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { BrandView } from './BrandView'
import { CreditView } from './CreditView'
import { DomainsView } from './DomainsView'
import { NewWorkspaceView } from './NewWorkspaceView'
import { INVITED_WORKSPACE } from '@/ee/lib/organizations/invitation-preview'
import { TeamView } from './TeamView'
import { consoleStatusOf, type BrandFields, type ConsolePerson, type ConsoleResult, type ConsoleWorkspace, type ConsoleWorkspaceStatus, type ConsoleRefusal, type CreditTransfer, type OrganizationRole } from './types'
import { WorkspaceDetailView, type ClientRole } from './WorkspaceDetailView'
import { WorkspacesView } from './WorkspacesView'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    Element.prototype.scrollIntoView ??= () => {}
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    document.body.innerHTML = ''
})

const render = (node: ReactNode) => act(async () => root.render(<TooltipProvider>{node}</TooltipProvider>))

const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')]

function button(name: string): HTMLButtonElement {
    const found = buttons().find(candidate => candidate.textContent?.trim() === name || candidate.getAttribute('aria-label') === name)
    if (!found) throw new Error(`no button "${name}", only: ${buttons().map(candidate => candidate.textContent || candidate.getAttribute('aria-label')).join(', ')}`)
    return found
}

const click = (element: HTMLElement) => act(async () => element.click())

// The last one: a dialog is portaled after the page.
const lastButton = (name: string) => buttons().findLast(candidate => candidate.textContent?.trim() === name)!

async function type(selector: string, value: string) {
    const input = document.querySelector<HTMLInputElement>(selector)
    if (!input) throw new Error(`no field ${selector}`)
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

const submit = () => act(async () => void [...document.querySelectorAll('form')].at(-1)!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

// A disabled button sits in a focusable wrapper whose tooltip says why.
async function reasonOf(control: HTMLElement): Promise<string> {
    const wrapper = control.closest<HTMLElement>('span[tabindex="0"]')
    if (!wrapper) throw new Error('no reason around this control')
    await act(async () => wrapper.focus())
    const reason = document.querySelector('[role="tooltip"]')?.textContent ?? ''
    await act(async () => wrapper.blur())
    return reason
}

const noop = () => {}
const BRAND: Brand = { ...RERUN_BRAND, organizationId: 'o1', name: 'Nordlys', appUrl: 'https://nordlys.rerun.work' }

// A menu opens from the keyboard here: happy-dom has no pointer capture.
async function menu(trigger: string) {
    await act(async () => void button(trigger).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
}

function item(name: string): HTMLElement {
    const found = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(candidate => candidate.textContent?.trim() === name)
    if (!found) throw new Error(`no menu item "${name}"`)
    return found
}

const isOff = (element: HTMLElement) => element.getAttribute('aria-disabled') === 'true'

const ok = async () => ({ ok: true as const })

const workspace = (name: string, creditCount = 100, status: ConsoleWorkspaceStatus = 'active', overrides: Partial<ConsoleWorkspace> = {}): ConsoleWorkspace => ({ id: 7, name: `Client ${name}`, iconUrl: null, status, memberCount: 2, coworkerCount: 1, coworkers: [{ id: 'c1', name: 'Nova', look: null, status: 'idle' }], pendingAdmin: null, creditMicros: creditCount * MICROS_PER_CREDIT, spentPerDayMicros: 0, machine: 'running', diskPercent: null, lastActivityAt: null, ...overrides })

describe('consoleStatusOf', () => {
    it.each([
        [{ status: 'suspended', machine: 'archiving', leftMicros: 5 }, 'suspended'],
        [{ status: 'archived', machine: 'archiving', leftMicros: 5 }, 'archiving'],
        [{ status: 'archived', machine: 'archived', leftMicros: 0 }, 'archived'],
        [{ status: 'active', machine: 'restoring', leftMicros: 5 }, 'restoring'],
        [{ status: 'active', machine: 'none', leftMicros: 5 }, 'provisioning'],
        [{ status: 'active', machine: 'none', leftMicros: 0 }, 'provisioning'],
        [{ status: 'archived', machine: 'none', leftMicros: 5 }, 'archived'],
        [{ status: 'active', machine: 'running', leftMicros: 5 }, 'active'],
        [{ status: 'active', machine: 'running', leftMicros: 0 }, 'outOfCredit'],
    ] as const)('reads %j as %s', (workspace, expected) => {
        expect(consoleStatusOf(workspace)).toBe(expected)
    })
})

describe('WorkspacesView', () => {
    type View = Parameters<typeof WorkspacesView>[0]
    const view = (workspaces: ConsoleWorkspace[], maxWorkspaces: number, props: Partial<View> = {}) => <WorkspacesView workspaces={workspaces} maxWorkspaces={maxWorkspaces} reserveMicros={100 * MICROS_PER_CREDIT} block={null} resendingId={null} onAddCredit={noop} onResend={noop} {...props} />
    const some = (count: number) => Array.from({ length: count }, (_, index) => ({ ...workspace(String(index)), id: index }))
    const titles = () => [...container.querySelectorAll('h2')].map(title => title.textContent)

    it('creates under the limit', async () => {
        await render(view(some(2), 3))
        expect(container.querySelector('a[href="/organization/workspaces/new"]')?.textContent).toBe('New workspace')
        expect(container.textContent).toContain('2 of 3')
    })

    it('says why at the limit', async () => {
        await render(view(some(3), 3))
        expect(await reasonOf(button('New workspace'))).toContain('limited to 3 workspaces')
    })

    it('says the organization is suspended before the limit', async () => {
        await render(view(some(3), 3, { block: 'suspended' }))
        expect(await reasonOf(button('New workspace'))).toContain('suspended')
    })

    it('finds a workspace by its name', async () => {
        await render(view(some(9), 20))
        await type('input[type="search"]', 'client 4')
        expect(titles()).toEqual(['Client 4'])
        await type('input[type="search"]', 'zzz')
        expect(container.textContent).toContain('No workspace matches “zzz”')
    })

    it('asks for a first workspace when none is left, without naming a search', async () => {
        await render(view([], 3))
        expect(container.textContent).toContain('Create your first workspace')
        expect(container.textContent).not.toContain('No workspace matches')
    })

    it('shows twelve at a time', async () => {
        await render(view(some(30), 40))
        expect(titles()).toHaveLength(12)
        await click(button('Show more'))
        expect(titles()).toHaveLength(24)
        await click(button('Show more'))
        expect(titles()).toHaveLength(30)
        expect(buttons().some(candidate => candidate.textContent === 'Show more')).toBe(false)
    })

    it('puts what needs the agency first, the worst at the top, with what to do about it', async () => {
        const onAddCredit = vi.fn()
        const onResend = vi.fn()
        await render(
            view(
                [
                    workspace('quiet', 10, 'archived', { id: 1 }),
                    workspace('fine', 500, 'active', { id: 2, spentPerDayMicros: 10 * MICROS_PER_CREDIT }),
                    workspace('invited', 500, 'provisioning', { id: 3, memberCount: 0, coworkers: [], coworkerCount: 0, pendingAdmin: { invitationId: 'i', email: 'nadia@delta.test', expired: false } }),
                    workspace('low', 70, 'active', { id: 4, spentPerDayMicros: 10 * MICROS_PER_CREDIT }),
                    workspace('full', 500, 'active', { id: 5, diskPercent: 94 }),
                    workspace('out', 0, 'outOfCredit', { id: 6 }),
                ],
                12,
                { onAddCredit, onResend },
            ),
        )
        expect(titles()).toEqual(['Client full', 'Client out', 'Client invited', 'Client low', 'Client fine', 'Client quiet'])
        for (const text of ['Disk 94% full', 'Out of credit, coworkers are paused', 'Waiting for nadia@delta.test', 'Credit for 7 more days', '500 credits, 50 days', 'Archived']) expect(container.textContent).toContain(text)
        expect([...container.querySelectorAll('a')].find(link => link.textContent === 'See machine')?.getAttribute('href')).toBe('/organization/workspaces/5')
        await click(button('Add credit'))
        expect(onAddCredit).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }))
        await click(button('Resend invite'))
        expect(onResend).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }))
    })

    it('offers no credit from an empty reserve, and nothing under a suspended organization', async () => {
        const out = [workspace('out', 0, 'outOfCredit')]
        await render(view(out, 12, { reserveMicros: 0 }))
        expect(await reasonOf(button('Add credit'))).toBe('The reserve is empty')
        await render(view(out, 12, { block: 'suspended' }))
        expect(await reasonOf(button('Add credit'))).toContain('suspended')
    })
})

describe('NewWorkspaceView', () => {
    type View = Parameters<typeof NewWorkspaceView>[0]
    const onCreate = vi.fn<View['onCreate']>()
    beforeEach(() => void onCreate.mockReset().mockResolvedValue({ ok: true, workspaceId: 9, inviteUrl: 'https://x.test/invite/abc' }))
    const view = (props: Partial<View> = {}) => <NewWorkspaceView brand={BRAND} email={`<p>Join ${INVITED_WORKSPACE}</p>`} reserveMicros={700 * MICROS_PER_CREDIT} limitReached={null} block={null} onCreate={onCreate} {...props} />
    const fill = async () => {
        await type('#new-workspace-name', ' Globex ')
        await type('#new-workspace-email', 'Hank@Globex.test')
    }

    it('creates with the credit picked, then hands over the link of the invitation', async () => {
        await render(view())
        expect(button('Create and invite').disabled).toBe(true)
        await fill()
        expect(container.textContent).toContain('200 left in reserve')
        await click(button('250'))
        expect(container.textContent).toContain('450 left in reserve')
        await submit()
        expect(onCreate).toHaveBeenCalledExactlyOnceWith({ name: 'Globex', adminEmail: 'hank@globex.test', logo: null, starting: { credits: 250, requestId: expect.any(String) } })
        expect(container.textContent).toContain('Globex is ready.')
        expect(container.textContent).toContain('https://x.test/invite/abc')
        expect(container.querySelector('a[href="/organization/workspaces/9"]')?.textContent).toBe('See workspace')
    })

    it('starts with no credit when the reserve is short, and refuses what it does not hold', async () => {
        await render(view({ reserveMicros: 300 * MICROS_PER_CREDIT }))
        expect(button('None').getAttribute('aria-pressed')).toBe('true')
        expect(await reasonOf(button('500'))).toBe('Your reserve holds 300 credits')
        expect(button('250').disabled).toBe(false)
        await fill()
        await submit()
        expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ starting: null }))
    })

    it('says when the credit did not follow', async () => {
        onCreate.mockResolvedValue({ ok: true, workspaceId: 9, creditFailed: true })
        await render(view())
        await fill()
        await submit()
        expect(container.textContent).toContain('The credit could not be added')
    })

    it('keeps the form with the reason of a refusal, and the same request', async () => {
        onCreate.mockResolvedValue({ ok: false, code: 'createWorkspaceFailed' })
        await render(view())
        await fill()
        await submit()
        await submit()
        expect(document.querySelector<HTMLInputElement>('#new-workspace-name')!.value).toBe(' Globex ')
        const [first, second] = onCreate.mock.calls.map(([created]) => created.starting!.requestId)
        expect(second).toBe(first)
    })

    it('creates once on a double submit', async () => {
        let finish: () => void = noop
        onCreate.mockReturnValue(new Promise(resolve => (finish = () => resolve({ ok: true, workspaceId: 9 }))))
        await render(view())
        await fill()
        await submit()
        await submit()
        expect(onCreate).toHaveBeenCalledTimes(1)
        await act(async () => finish())
    })

    it('creates nothing at the limit, nor under a suspended organization', async () => {
        await render(view({ limitReached: 3 }))
        await fill()
        expect(await reasonOf(button('Create and invite'))).toContain('limited to 3 workspaces')
        await submit()
        await render(view({ block: 'suspended' }))
        expect(await reasonOf(button('Create and invite'))).toContain('suspended')
        expect(onCreate).not.toHaveBeenCalled()
    })
})

describe('CreditView', () => {
    type View = Parameters<typeof CreditView>[0]
    const onGive = vi.fn<View['onGive']>()
    beforeEach(() => void onGive.mockReset().mockResolvedValue(new Map()))
    const view = (reserve: number, workspaces: ConsoleWorkspace[], props: Partial<View> = {}) => <CreditView reserveMicros={reserve * MICROS_PER_CREDIT} workspaces={workspaces} movements={[]} hasMore={false} loadingMore={false} block={null} onLoadMore={noop} onGive={onGive} onTakeBack={ok} {...props} />
    const two = [workspace('a', 40, 'active', { id: 1 }), workspace('b', 0, 'outOfCredit', { id: 2 })]
    const field = (name: string) => `input[aria-label="Credit for Client ${name}"]`

    it('lists whose credit ends first, without what is put away', async () => {
        await render(view(10, [workspace('unused', 40, 'active', { id: 1 }), workspace('long', 40, 'active', { id: 2, spentPerDayMicros: MICROS_PER_CREDIT }), workspace('short', 40, 'active', { id: 3, spentPerDayMicros: 8 * MICROS_PER_CREDIT }), workspace('out', 0, 'outOfCredit', { id: 4 }), workspace('gone', 40, 'archived', { id: 5 })]))
        expect([...container.querySelectorAll('form input')].map(input => input.getAttribute('aria-label'))).toEqual(['Credit for Client out', 'Credit for Client short', 'Credit for Client long', 'Credit for Client unused'])
    })

    it('gives to several at once, one request each', async () => {
        await render(view(500, two))
        await type(field('a'), '120')
        await type(field('b'), '1000')
        expect(container.textContent).toContain('More than the reserve')
        await submit()
        expect(onGive).not.toHaveBeenCalled()
        await type(field('b'), '30')
        expect(container.textContent).toContain('350 left in reserve')
        await submit()
        const [[transfers]] = onGive.mock.calls
        expect(transfers).toEqual([
            { workspaceId: 2, credits: 30, requestId: expect.any(String) },
            { workspaceId: 1, credits: 120, requestId: expect.any(String) },
        ])
        expect(transfers[0].requestId).not.toBe(transfers[1].requestId)
        expect(document.querySelector<HTMLInputElement>(field('a'))!.value).toBe('')
        expect(buttons().some(candidate => candidate.textContent?.startsWith('Give'))).toBe(false)
    })

    it('keeps the amount, the reason and the request of the one that did not go through', async () => {
        const refusal: ConsoleRefusal = { ok: false, code: 'workspaceArchived' }
        onGive.mockResolvedValueOnce(new Map([[1, refusal]]))
        await render(view(500, two))
        await type(field('a'), '120')
        await type(field('b'), '30')
        await submit()
        expect(document.querySelector<HTMLInputElement>(field('a'))!.value).toBe('120')
        expect(document.querySelector<HTMLInputElement>(field('b'))!.value).toBe('')
        expect(container.querySelector('form')!.textContent).toMatch(/archived|restore/i)
        await submit()
        const [first, second] = onGive.mock.calls.map(([transfers]) => transfers.find(({ workspaceId }) => workspaceId === 1)!.requestId)
        expect(second).toBe(first)
        expect(onGive.mock.calls[1][0]).toHaveLength(1)
    })

    it('sends once on a double submit', async () => {
        let finish: () => void = noop
        onGive.mockReturnValue(new Promise(resolve => (finish = () => resolve(new Map()))))
        await render(view(500, two))
        await type(field('a'), '1')
        await submit()
        await submit()
        expect(onGive).toHaveBeenCalledTimes(1)
        await act(async () => finish())
    })

    it('clears what was typed', async () => {
        await render(view(500, two))
        await type(field('a'), '5')
        await click(button('Clear'))
        expect(document.querySelector<HTMLInputElement>(field('a'))!.value).toBe('')
    })

    it('gives nothing to a machine on its way back, nor under a suspended organization', async () => {
        await render(view(10, [workspace('a', 5, 'restoring')]))
        expect(await reasonOf(document.querySelector<HTMLElement>(field('a'))!)).toBe('Restoring')
        await render(view(10, two, { block: 'suspended' }))
        expect(await reasonOf(document.querySelector<HTMLElement>(field('a'))!)).toContain('suspended')
    })

    it('takes back from its menu, when one has credit', async () => {
        await render(view(10, []))
        expect(container.textContent).toContain('Create a workspace first')
        await menu('More')
        expect(isOff(item('Take back'))).toBe(true)
        await act(async () => root.render(null))
        await render(view(10, two))
        await menu('More')
        await click(item('Take back'))
        expect(document.body.textContent).toContain('Take credit back')
    })
})

describe('credit of a workspace', () => {
    const onAllocate = vi.fn<(transfer: CreditTransfer) => Promise<ConsoleResult>>(async () => ({ ok: true }))
    beforeEach(() => onAllocate.mockClear())

    const open = (reserve: number) => render(detail({ workspace: workspace('a', 40), reserveMicros: reserve * MICROS_PER_CREDIT, onAllocate }))

    it('shows the balance and the reserve after the transfer, then sends whole credits', async () => {
        await open(500)
        await type('#workspace-credit-amount', '120')
        expect(document.body.textContent).toContain('40 → 160')
        expect(document.body.textContent).toContain('380 in reserve')

        await submit()
        expect(onAllocate).toHaveBeenCalledWith({ workspaceId: 7, credits: 120, requestId: expect.any(String) })
        expect(document.querySelector<HTMLInputElement>('#workspace-credit-amount')!.value).toBe('')
    })

    it('refuses more than the reserve holds, and says it', async () => {
        await open(500)
        await type('#workspace-credit-amount', '501')
        expect(button('Add credit').disabled).toBe(true)
        expect(document.body.textContent).toContain('Your reserve holds 500 credits')
        await submit()
        expect(onAllocate).not.toHaveBeenCalled()
    })

    it('refuses zero', async () => {
        await open(500)
        await type('#workspace-credit-amount', '0')
        await submit()
        expect(onAllocate).not.toHaveBeenCalled()
    })

    it('keeps the request of a failed send, and starts a new one once the amount changes', async () => {
        onAllocate.mockResolvedValue({ ok: false, error: 'Try again' })
        await open(500)
        await type('#workspace-credit-amount', '10')
        await submit()
        expect(document.body.textContent).toContain('Try again')
        await submit()
        await type('#workspace-credit-amount', '11')
        await submit()
        const [first, second, third] = onAllocate.mock.calls.map(([transfer]) => transfer.requestId)
        expect(second).toBe(first)
        expect(third).not.toBe(first)
        onAllocate.mockResolvedValue({ ok: true })
    })

    it('sends once on a double submit', async () => {
        let finish: (result: ConsoleResult) => void = noop
        onAllocate.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)))
        await open(500)
        await type('#workspace-credit-amount', '10')
        await submit()
        await submit()
        expect(onAllocate).toHaveBeenCalledTimes(1)
        await act(async () => finish({ ok: true }))
    })
})

function detail(props: Partial<Parameters<typeof WorkspaceDetailView>[0]> = {}) {
    return (
        <WorkspaceDetailView
            workspace={workspace('a')}
            members={[]}
            invitations={[]}
            reserveMicros={0}
            machine={{ state: 'running', disk: null }}
            usage={null}
            pending={null}
            block={null}
            onOpenWorkspace={noop}
            onInvite={ok}
            onRoleChange={noop}
            onRemove={noop}
            onRevoke={noop}
            onResend={noop}
            onCopyLink={noop}
            onAllocate={ok}
            onTakeBack={ok}
            onRestart={noop}
            onArchive={noop}
            onRestore={noop}
            onDelete={noop}
            {...props}
        />
    )
}

describe('WorkspaceDetailView', () => {
    const member = (userId: string, role: ClientRole): ConsolePerson<ClientRole> => ({ userId, name: userId, email: `${userId}@acme.com`, photo: null, role, isSelf: false })

    const pick = async (name: string) => {
        await menu('More')
        await click(item(name))
    }

    it('deletes only once the name is typed', async () => {
        const onDelete = vi.fn()
        await render(detail({ onDelete }))
        await pick('Delete')
        expect(lastButton('Delete').disabled).toBe(true)

        await type('input[aria-label="Client a"]', 'client a')
        expect(lastButton('Delete').disabled).toBe(true)

        await type('input[aria-label="Client a"]', 'Client a ')
        expect(lastButton('Delete').disabled).toBe(false)
        expect(onDelete).not.toHaveBeenCalled()
        await click(lastButton('Delete'))
        expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('asks for the name again when it reopens', async () => {
        await render(detail())
        await pick('Delete')
        await type('input[aria-label="Client a"]', 'Client a')
        await click(lastButton('Cancel'))
        await pick('Delete')
        expect(lastButton('Delete').disabled).toBe(true)
    })

    it('archives and restarts only after a confirmation', async () => {
        const onArchive = vi.fn()
        const onRestart = vi.fn()
        await render(detail({ onArchive, onRestart }))
        await pick('Archive')
        expect(onArchive).not.toHaveBeenCalled()
        await click(lastButton('Archive'))
        expect(onArchive).toHaveBeenCalledTimes(1)
        await pick('Restart')
        expect(onRestart).not.toHaveBeenCalled()
        await click(lastButton('Restart'))
        expect(onRestart).toHaveBeenCalledTimes(1)
    })

    it('restores an archived workspace, which cannot be opened, restarted nor given credit', async () => {
        const onRestore = vi.fn()
        await render(detail({ workspace: workspace('a', 10, 'archived'), reserveMicros: 100 * MICROS_PER_CREDIT, onRestore }))
        expect(buttons().some(candidate => candidate.textContent === 'Open')).toBe(false)
        expect(await reasonOf(button('Add credit'))).toBe('Restore this workspace first')
        await click(button('Restore'))
        expect(onRestore).toHaveBeenCalledTimes(1)
        await menu('More')
        expect(isOff(item('Restart'))).toBe(true)
        expect(isOff(item('Take back'))).toBe(false)
        expect(isOff(item('Delete'))).toBe(false)
        expect(() => item('Archive')).toThrow()
    })

    it('opens, archives and gives credit to one nobody has used yet', async () => {
        await render(detail({ workspace: workspace('a', 0, 'provisioning'), reserveMicros: 100 * MICROS_PER_CREDIT }))
        expect(button('Open').disabled).toBe(false)
        await menu('More')
        for (const name of ['Archive', 'Delete']) expect(isOff(item(name)), name).toBe(false)
    })

    it.each(['archiving', 'restoring'] as const)('waits while it is %s', async status => {
        await render(detail({ workspace: workspace('a', 10, status) }))
        expect(await reasonOf(button('Open'))).toBe('This workspace is not ready yet')
        await menu('More')
        for (const name of ['Delete', 'Restart']) expect(isOff(item(name)), name).toBe(true)
    })

    it('has no machine to restart before its first coworker', async () => {
        await render(detail({ machine: { state: 'none', disk: null } }))
        expect(container.textContent).toContain('Not started')
        await menu('More')
        expect(isOff(item('Restart'))).toBe(true)
    })

    it('tells the machine, its disk and its admin', async () => {
        await render(detail({ machine: { state: 'running', disk: { usedMb: 620, totalMb: 1000 } }, members: [member('lea', 'admin')] }))
        expect(container.textContent).toContain('Running, disk 62%')
        expect(container.querySelector('dl')!.textContent).toContain('lea')
    })

    it('walks a new one to its first coworker, with its invitation at hand', async () => {
        const onResend = vi.fn()
        const onCopyLink = vi.fn()
        const fresh = workspace('a', 500, 'provisioning', { memberCount: 0, coworkerCount: 0, coworkers: [], pendingAdmin: { invitationId: 'i', email: 'nadia@delta.test', expired: false } })
        await render(detail({ workspace: fresh, onResend, onCopyLink }))
        for (const text of ['Going live', '2 of 4', '500 credits added', 'nadia@delta.test joins', 'Waiting for its admin']) expect(container.textContent).toContain(text)
        expect(container.textContent).not.toContain('Usage')
        await click(button('Resend'))
        await click(button('Copy link'))
        expect([onResend.mock.calls.length, onCopyLink.mock.calls.length]).toEqual([1, 1])
    })

    it('keeps the usage of one that spent and has no coworker', async () => {
        await render(detail({ workspace: workspace('a', 40, 'active', { coworkerCount: 0, coworkers: [], spentPerDayMicros: MICROS_PER_CREDIT }) }))
        for (const text of ['Going live', 'Usage']) expect(container.textContent).toContain(text)
    })

    it('invites an admin again when the invitation is gone', async () => {
        await render(detail({ workspace: workspace('a', 0, 'provisioning', { memberCount: 0, coworkerCount: 0, coworkers: [] }) }))
        await click(button('Invite'))
        expect(document.querySelector('#invite-email')).not.toBeNull()
    })

    it('hands over the link of an invitation no email carries', async () => {
        await render(detail({ onInvite: async () => ({ ok: true, inviteUrl: 'https://x.test/invite/abc' }) }))
        await click(button('Invite'))
        await type('#invite-email', 'Jo@Acme.com')
        await submit()
        expect(document.body.textContent).toContain('Send this link to jo@acme.com.')
        expect(document.body.textContent).toContain('https://x.test/invite/abc')
    })

    it('keeps its last admin', async () => {
        await render(detail({ members: [member('lea', 'admin'), member('jo', 'member')] }))
        expect(await reasonOf(button('Remove lea'))).toBe('A workspace keeps at least one admin')
        expect(button('Remove jo').disabled).toBe(false)

        await render(detail({ members: [member('lea', 'admin'), member('jo', 'admin')] }))
        expect(button('Remove lea').disabled).toBe(false)
    })

    it('is read only under a suspended organization', async () => {
        await render(detail({ block: 'suspended', members: [member('lea', 'admin'), member('jo', 'member')], reserveMicros: 100 * MICROS_PER_CREDIT }))
        for (const name of ['Open', 'Add credit', 'Invite', 'Remove jo']) {
            expect(button(name).disabled, name).toBe(true)
            expect(await reasonOf(button(name)), name).toContain('suspended')
        }
        await menu('More')
        for (const name of ['Take back', 'Restart', 'Archive', 'Delete']) expect(isOff(item(name)), name).toBe(true)
    })
})

describe('TeamView', () => {
    const person = (userId: string, role: OrganizationRole, isSelf = false): ConsolePerson<OrganizationRole> => ({ userId, name: userId, email: `${userId}@nordlys.agency`, photo: null, role, isSelf })
    const view = (people: ConsolePerson<OrganizationRole>[], block: 'ownerOnly' | null = null, onRemove = noop as (removed: ConsolePerson<OrganizationRole>) => void) => <TeamView people={people} invitations={[{ id: 'i', email: 'new@nordlys.agency' }]} block={block} onInvite={ok} onRoleChange={noop} onRemove={onRemove} onRevoke={noop} />

    it('protects the last owner', async () => {
        await render(view([person('camille', 'owner', true), person('ines', 'admin')]))
        expect(await reasonOf(button('Remove camille'))).toBe('An organization keeps at least one owner')
        expect(button('Role of camille').disabled).toBe(true)
        expect(button('Role of ines').disabled).toBe(false)
    })

    it('leaves your own role to another owner', async () => {
        await render(view([person('camille', 'owner', true), person('samir', 'owner')]))
        expect(await reasonOf(button('Remove camille'))).toBe('Another owner can change your role')
        expect(button('Remove samir').disabled).toBe(false)
    })

    it('is read only for an admin', async () => {
        await render(view([person('camille', 'owner'), person('samir', 'owner'), person('ines', 'admin', true)], 'ownerOnly'))
        for (const name of ['Invite', 'Remove camille', 'Remove ines', 'Cancel the invitation of new@nordlys.agency']) expect(await reasonOf(button(name)), name).toBe('Only an owner can do this')
    })

    it('removes after a confirmation that names the person', async () => {
        const onRemove = vi.fn()
        await render(view([person('camille', 'owner', true), person('ines', 'admin')], null, onRemove))
        await click(button('Remove ines'))
        expect(document.body.textContent).toContain('Remove ines?')
        expect(onRemove).not.toHaveBeenCalled()
        await click(button('Remove'))
        expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ userId: 'ines' }))
    })
})

describe('BrandView', () => {
    const FIELDS: BrandFields = { name: 'Nordlys', color: '#1668e3', supportEmail: '', docsUrl: '', termsUrl: '', privacyUrl: '' }
    const bar = () => document.body.textContent?.includes('Unsaved changes')
    const view = (onSave = vi.fn(ok), block: 'ownerOnly' | null = null) => (
        <>
            <a href="#elsewhere">Elsewhere</a>
            <BrandView fields={FIELDS} brand={BRAND} iconUrl={null} block={block} onSave={onSave} />
        </>
    )

    it('shows the save bar only once something changed', async () => {
        await render(view())
        expect(bar()).toBe(false)
        await type('#brand-name', 'Nordlys 2')
        expect(bar()).toBe(true)
        await type('#brand-name', 'Nordlys')
        expect(bar()).toBe(false)
    })

    it('takes a space after the name, or the same color written another way, for no change', async () => {
        await render(view())
        await type('#brand-name', 'Nordlys ')
        expect(bar()).toBe(false)
        await type('#brand-color', '#1668E3')
        expect(bar()).toBe(false)
    })

    it('discards back to what is saved', async () => {
        await render(view())
        await type('#brand-name', 'Other')
        await click(button('Discard'))
        expect(bar()).toBe(false)
        expect(document.querySelector<HTMLInputElement>('#brand-name')!.value).toBe('Nordlys')
    })

    it('does not save an invalid field', async () => {
        const onSave = vi.fn(ok)
        await render(view(onSave))
        await type('#brand-color', '#12')
        expect(button('Save').disabled).toBe(true)
        await submit()
        expect(onSave).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain('Use a hex color')
    })

    it('says what is wrong with each field', async () => {
        await render(view())
        await type('#brand-name', 'a|b')
        await type('#brand-support', 'help@')
        await type('#brand-docsUrl', 'help.com')
        for (const text of ['without { } < > # |', 'Enter a valid email address', 'starting with https://']) expect(document.body.textContent).toContain(text)
    })

    it('saves trimmed fields and a full hex', async () => {
        const onSave = vi.fn(ok)
        await render(view(onSave))
        await type('#brand-name', '  Nordlys  ')
        await type('#brand-color', '#16E')
        await submit()
        expect(onSave).toHaveBeenCalledWith({ ...FIELDS, color: '#1166ee' }, null)
    })

    it('says when a color is kept off the signals', async () => {
        await render(view())
        expect(document.body.textContent).not.toContain('only the chat bubble')
        await type('#brand-color', '#e11d2e')
        expect(document.body.textContent).toContain('already means an error')
    })

    it('holds a link while a change is not saved, and lets it through on Leave', async () => {
        await render(view())
        const followed = vi.fn((event: Event) => event.preventDefault())
        const link = document.querySelector('a')!
        link.addEventListener('click', followed)

        await click(link)
        expect(followed).toHaveBeenCalledTimes(1)

        await type('#brand-name', 'Other')
        await click(link)
        expect(followed).toHaveBeenCalledTimes(1)
        expect(document.body.textContent).toContain('Leave without saving?')

        await click(button('Stay'))
        expect(followed).toHaveBeenCalledTimes(1)

        await click(link)
        await click(button('Leave'))
        expect(followed).toHaveBeenCalledTimes(2)
    })

    it('is read only for an admin', async () => {
        await render(view(vi.fn(ok), 'ownerOnly'))
        expect([...document.querySelectorAll('fieldset')].every(fieldset => fieldset.disabled)).toBe(true)
        expect(document.body.textContent).toContain('Only an owner can do this')
    })
})

describe('DomainsView', () => {
    const view = (onAdd = vi.fn(ok), block: 'ownerOnly' | null = null) => (
        <DomainsView
            brand={BRAND}
            defaultHostname="nordlys.rerun.work"
            domains={[
                { id: 'd1', hostname: 'app.nordlys.agency', status: 'error', error: 'It points elsewhere.', records: [{ type: 'CNAME', name: 'app', value: 'edge.rerun.work' }], lastCheckedAt: null },
                { id: 'd2', hostname: 'live.nordlys.agency', status: 'active', error: null, records: [{ type: 'CNAME', name: 'live', value: 'edge.rerun.work' }], lastCheckedAt: null },
            ]}
            checkingId={null}
            block={block}
            onAdd={onAdd}
            onCheck={noop}
            onRemove={noop}
        />
    )

    it('shows the record and the reason until the domain is live', async () => {
        await render(view())
        expect(container.textContent).toContain('It points elsewhere.')
        expect(container.textContent).toContain('edge.rerun.work')
        expect(buttons().filter(candidate => candidate.textContent === 'Check now')).toHaveLength(1)
    })

    it('shows what to publish again, and a check, for a domain still served whose DNS left', async () => {
        const failing = { id: 'd3', hostname: 'gone.nordlys.agency', status: 'active' as const, error: 'This domain points somewhere else.', records: [{ type: 'CNAME' as const, name: 'gone', value: 'edge.rerun.work' }], lastCheckedAt: null }
        const onCheck = vi.fn()
        await render(<DomainsView brand={BRAND} defaultHostname="nordlys.rerun.work" domains={[failing]} checkingId={null} block={null} onAdd={vi.fn(ok)} onCheck={onCheck} onRemove={noop} />)
        expect(container.textContent).toContain('gone.nordlys.agency stopped pointing here')
        expect(container.textContent).toContain('This domain points somewhere else.')
        expect(container.textContent).toContain('edge.rerun.work')
        await click(button('Check now'))
        expect(onCheck).toHaveBeenCalledWith(failing)
    })

    it('stays open, Cancel off, until the domain it sent is answered', async () => {
        let answer: (result: { ok: true }) => void = noop
        const onAdd = vi.fn(() => new Promise<{ ok: true }>(resolve => (answer = resolve)))
        await render(view(onAdd))
        await click(button('Add a domain'))
        await type('#organization-hostname', 'app.acme.com')
        await submit()
        expect(lastButton('Cancel').disabled).toBe(true)
        await act(async () => void document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
        expect(document.querySelector('#organization-hostname')).not.toBeNull()

        await act(async () => answer({ ok: true }))
        expect(document.querySelector('#organization-hostname')).toBeNull()
    })

    it('adds the domain of a pasted address, and refuses a bare one', async () => {
        const onAdd = vi.fn(ok)
        await render(view(onAdd))
        await click(button('Add a domain'))
        await type('#organization-hostname', 'acme.com')
        await submit()
        expect(onAdd).not.toHaveBeenCalled()
        expect(document.body.textContent).toContain('Use a subdomain, like app.acme.com')

        await type('#organization-hostname', 'https://App.acme.com/')
        await submit()
        expect(onAdd).toHaveBeenCalledWith('app.acme.com')
    })

    it('is read only for an admin', async () => {
        await render(view(vi.fn(ok), 'ownerOnly'))
        for (const name of ['Add a domain', 'Check now']) expect(await reasonOf(button(name)), name).toBe('Only an owner can do this')
        await menu('More about app.nordlys.agency')
        expect(isOff(item('Remove'))).toBe(true)
    })

    it('leads with the domain being served, the included address under it', async () => {
        const onRemove = vi.fn()
        await render(<DomainsView brand={BRAND} defaultHostname="nordlys.rerun.work" domains={[{ id: 'd2', hostname: 'live.nordlys.agency', status: 'active', error: null, records: [], lastCheckedAt: null }]} checkingId={null} block={null} onAdd={vi.fn(ok)} onCheck={noop} onRemove={onRemove} />)
        expect(container.querySelector('h1')!.textContent).toBe('live.nordlys.agency')
        expect(container.textContent).toContain('Also answers')
        await menu('More about live.nordlys.agency')
        await click(item('Remove'))
        expect(onRemove).not.toHaveBeenCalled()
        await click(lastButton('Remove'))
        expect(onRemove).toHaveBeenCalledTimes(1)
    })
})
