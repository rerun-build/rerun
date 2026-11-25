// @vitest-environment happy-dom
import { MICROS_PER_CREDIT } from '@rerun/contracts'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'

import { BrandView } from './BrandView'
import { CreditView } from './CreditView'
import { DomainsView } from './DomainsView'
import { TeamView } from './TeamView'
import { consoleStatusOf, type BrandFields, type ConsolePerson, type ConsoleResult, type ConsoleWorkspace, type ConsoleWorkspaceStatus, type CreditTransfer, type OrganizationRole } from './types'
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

const submit = () => act(async () => void document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))

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
const ok = async () => ({ ok: true as const })

const workspace = (name: string, creditCount = 100, status: ConsoleWorkspaceStatus = 'active'): ConsoleWorkspace => ({ id: 7, name: `Client ${name}`, iconUrl: null, status, memberCount: 2, coworkerCount: 1, creditMicros: creditCount * MICROS_PER_CREDIT, lastActivityAt: null })

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
    const view = (count: number, maxWorkspaces: number, block: 'suspended' | null = null) => <WorkspacesView workspaces={Array.from({ length: count }, (_, index) => ({ ...workspace(String(index)), id: index }))} maxWorkspaces={maxWorkspaces} block={block} onOpen={noop} onNew={noop} />

    it('creates under the limit', async () => {
        await render(view(2, 3))
        expect(button('New workspace').disabled).toBe(false)
        expect(container.textContent).toContain('2 of 3')
    })

    it('says why at the limit', async () => {
        await render(view(3, 3))
        expect(button('New workspace').disabled).toBe(true)
        expect(await reasonOf(button('New workspace'))).toContain('limited to 3 workspaces')
    })

    it('says the organization is suspended before the limit', async () => {
        await render(view(3, 3, 'suspended'))
        expect(await reasonOf(button('New workspace'))).toContain('suspended')
    })

    it('waits for the list before anything can be created', async () => {
        await render(<WorkspacesView workspaces={null} maxWorkspaces={3} block={null} onOpen={noop} onNew={noop} />)
        expect(button('New workspace').disabled).toBe(true)
        expect(container.querySelector('[data-slot="skeleton"]')).toBeTruthy()
    })

    it('gets a search past eight workspaces', async () => {
        await render(view(8, 20))
        expect(container.querySelector('input[type="search"]')).toBeNull()

        await render(view(9, 20))
        await type('input[type="search"]', 'client 4')
        expect(container.textContent).toContain('Client 4')
        expect(container.textContent).not.toContain('Client 5')

        await type('input[type="search"]', 'zzz')
        expect(container.textContent).toContain('No workspace matches “zzz”')
    })
})

describe('CreditView', () => {
    const view = (reserve: number, workspaces: ConsoleWorkspace[], onAllocate = vi.fn(ok), onTakeBack = vi.fn(ok)) => (
        <CreditView reserveMicros={reserve * MICROS_PER_CREDIT} workspaces={workspaces} movements={[]} hasMore={false} loadingMore={false} block={null} onLoadMore={noop} onAllocate={onAllocate} onTakeBack={onTakeBack} />
    )

    it('refuses to give from an empty reserve, and says it', async () => {
        await render(view(0, [workspace('a')]))
        expect(await reasonOf(button('Add credit'))).toBe('The reserve is empty')
    })

    it('refuses to give with no workspace, and to take back when none has credit', async () => {
        await render(view(10, []))
        expect(await reasonOf(button('Add credit'))).toBe('Create a workspace first')
        expect(await reasonOf(button('Take back'))).toBe('No workspace has credit left')
    })
})

describe('credit of a workspace', () => {
    const onAllocate = vi.fn<(transfer: CreditTransfer) => Promise<ConsoleResult>>(async () => ({ ok: true }))
    beforeEach(() => onAllocate.mockClear())

    const open = async (reserve: number) => {
        await render(detail({ workspace: workspace('a', 40), reserveMicros: reserve * MICROS_PER_CREDIT, onAllocate }))
        await click(button('Add credit'))
    }

    it('shows both balances after the transfer, then sends whole credits', async () => {
        await open(500)
        await type('#credit-amount', '120')
        expect(document.body.textContent).toContain('500 → 380')
        expect(document.body.textContent).toContain('40 → 160')

        await submit()
        expect(onAllocate).toHaveBeenCalledWith({ workspaceId: 7, credits: 120, requestId: expect.any(String) })
        expect(document.querySelector('#credit-amount')).toBeNull()
    })

    it('refuses more than the reserve holds, and says it', async () => {
        await open(500)
        await type('#credit-amount', '501')
        expect(button('Add credit').disabled).toBe(false)
        expect(lastButton('Add credit').disabled).toBe(true)
        expect(document.body.textContent).toContain('Your reserve holds 500 credits')
        await submit()
        expect(onAllocate).not.toHaveBeenCalled()
    })

    it('refuses zero', async () => {
        await open(500)
        await type('#credit-amount', '0')
        await submit()
        expect(onAllocate).not.toHaveBeenCalled()
    })

    it('keeps the request of a failed send, and starts a new one once the amount changes', async () => {
        onAllocate.mockResolvedValue({ ok: false, error: 'Try again' })
        await open(500)
        await type('#credit-amount', '10')
        await submit()
        expect(document.body.textContent).toContain('Try again')
        await submit()
        await type('#credit-amount', '11')
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
        await type('#credit-amount', '10')
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
            onBack={noop}
            onOpenWorkspace={noop}
            onInvite={ok}
            onRoleChange={noop}
            onRemove={noop}
            onRevoke={noop}
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

    it('deletes only once the name is typed', async () => {
        const onDelete = vi.fn()
        await render(detail({ onDelete }))
        await click(button('Delete'))
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
        await click(button('Delete'))
        await type('input[aria-label="Client a"]', 'Client a')
        await click(lastButton('Cancel'))
        await click(button('Delete'))
        expect(lastButton('Delete').disabled).toBe(true)
    })

    it('archives only after a confirmation', async () => {
        const onArchive = vi.fn()
        await render(detail({ onArchive }))
        await click(button('Archive'))
        expect(onArchive).not.toHaveBeenCalled()
        await click(lastButton('Archive'))
        expect(onArchive).toHaveBeenCalledTimes(1)
    })

    it('restores an archived workspace, which cannot be opened, restarted nor given credit', async () => {
        await render(detail({ workspace: workspace('a', 10, 'archived'), reserveMicros: 100 * MICROS_PER_CREDIT }))
        expect(buttons().some(candidate => candidate.textContent === 'Archive')).toBe(false)
        expect(button('Restore').disabled).toBe(false)
        for (const name of ['Open workspace', 'Restart', 'Add credit']) expect(await reasonOf(button(name))).toBe('Restore this workspace first')
        expect(button('Take back').disabled).toBe(false)
    })

    it('opens, archives and gives credit to one nobody has used yet', async () => {
        await render(detail({ workspace: workspace('a', 0, 'provisioning'), reserveMicros: 100 * MICROS_PER_CREDIT }))
        for (const name of ['Open workspace', 'Add credit', 'Archive', 'Delete']) expect(button(name).disabled, name).toBe(false)
    })

    it.each(['archiving', 'restoring'] as const)('waits while it is %s', async status => {
        await render(detail({ workspace: workspace('a', 10, status) }))
        expect(await reasonOf(button('Delete'))).toBe('Wait until it is done')
        expect(await reasonOf(button('Open workspace'))).toBe('This workspace is not ready yet')
    })

    it('has no machine to restart before its first coworker', async () => {
        await render(detail({ machine: { state: 'none', disk: null } }))
        expect(await reasonOf(button('Restart'))).toBe('Starts with its first coworker')
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
        for (const name of ['Open workspace', 'Add credit', 'Take back', 'Restart', 'Invite', 'Remove jo', 'Archive', 'Delete']) {
            expect(button(name).disabled, name).toBe(true)
            expect(await reasonOf(button(name)), name).toContain('suspended')
        }
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
            <BrandView fields={FIELDS} iconUrl={null} block={block} onSave={onSave} />
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
        expect(buttons().filter(candidate => candidate.textContent === 'Check again')).toHaveLength(1)
    })

    it('adds the domain of a pasted address, and refuses a bare one', async () => {
        const onAdd = vi.fn(ok)
        await render(view(onAdd))
        await click(button('Add domain'))
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
        for (const name of ['Add domain', 'Remove', 'Check again']) expect(await reasonOf(button(name)), name).toBe('Only an owner can do this')
    })
})
