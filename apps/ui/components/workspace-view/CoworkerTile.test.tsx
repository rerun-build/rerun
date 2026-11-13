// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { IsoAgent } from '@/lib/board/types'
import type { CoworkerPreview } from '@/stores/coworker-previews.store'

// The menu reads the Boxes from the board; the tile itself does not.
vi.mock('@/stores/board.store', () => ({ useBoardStore: (select: (state: { spaces: never[] }) => unknown) => select({ spaces: [] }) }))
vi.mock('@/hooks/useBoxAccess', () => ({ useCanManageAgent: () => true, useManageableSpaceIds: () => new Set() }))
vi.mock('@rerun/ui/iso-grid', () => ({ AgentBuddy: ({ mood }: { mood: string }) => createElement('span', { 'data-mood': mood }), buddyMoodOfStatus: (status: string, paused: boolean) => (paused ? 'asleep' : status) }))

const { CoworkerTile } = await import('@/components/workspace-view/CoworkerTile')

const agent = (patch: Partial<IsoAgent> = {}): IsoAgent => ({ id: 'a1', name: 'Scout', handle: 'scout', description: 'Finds leads', templateId: null, status: 'idle', position: { col: 1, row: 1 }, workspaceId: 7, spaceId: 's1', disabledAt: null, disabledReason: null, ...patch })
const preview = (patch: Partial<CoworkerPreview> = {}): CoworkerPreview => ({ sessionId: 's1', title: 'Q4 prospects', status: 'idle', updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(), lastMessage: null, ...patch })

let container: HTMLDivElement
let root: Root
const onOpen = vi.fn()
const actions = { onNewConversation: vi.fn(), onAllConversations: vi.fn(), onOpenCard: vi.fn(), onDuplicate: vi.fn(), onMoveToBox: vi.fn() }

async function render(props: { agent?: IsoAgent; preview?: CoworkerPreview; selected?: boolean; unseen?: boolean }) {
    await act(async () => root.render(createElement(CoworkerTile, { agent: props.agent ?? agent(), preview: props.preview, viewerId: 'me', selected: props.selected ?? false, unseen: props.unseen ?? false, onOpen, actions })))
}

const text = () => container.textContent ?? ''
const lineOf = (content: string) => [...container.querySelectorAll('span')].findLast(span => span.textContent === content)
const dots = () => container.querySelectorAll('.rounded-full.size-2')

beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    onOpen.mockReset()
})

afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
})

describe('CoworkerTile', () => {
    it('shows the name, when it last spoke and its latest conversation', async () => {
        await render({ preview: preview() })
        expect(text()).toContain('Scout')
        expect(text()).toContain('5m')
        expect(lineOf('Q4 prospects')?.className).toContain('text-muted-foreground')
        expect(dots()).toHaveLength(0)
    })

    it('shows the last message, "You:" only in front of the reader\'s own', async () => {
        await render({ preview: preview({ lastMessage: { text: 'Three new leads', from: 'agent', authorId: null } }) })
        expect(lineOf('Three new leads')).toBeDefined()
        await render({ preview: preview({ lastMessage: { text: 'Find leads', from: 'user', authorId: 'me' } }) })
        expect(lineOf('You: Find leads')).toBeDefined()
        await render({ preview: preview({ lastMessage: { text: 'Find leads', from: 'user', authorId: 'teammate' } }) })
        expect(lineOf('Find leads')).toBeDefined()
        expect(text()).not.toContain('You:')
    })

    it('falls back to the description, with no time, for a coworker nobody talked to', async () => {
        await render({})
        expect(lineOf('Finds leads')).toBeDefined()
        expect(text()).not.toMatch(/\d+m/)
    })

    it('says a paused coworker is paused and draws it asleep', async () => {
        await render({ agent: agent({ disabledAt: '2026-11-01T00:00:00Z', status: 'waiting_human' }), preview: preview() })
        expect(lineOf('Paused')).toBeDefined()
        expect(container.querySelector('[data-mood="asleep"]')).not.toBeNull()
        expect(dots()).toHaveLength(0)
    })

    it('colours what a waiting coworker waits on and marks it with an orange dot', async () => {
        await render({ agent: agent({ status: 'waiting_human' }), preview: preview({ title: 'Approve the renewal' }) })
        expect(lineOf('Approve the renewal')?.className).toContain('text-orange')
        expect(dots()[0]?.className).toContain('bg-orange-400')
    })

    it('marks an unseen result with the brand dot, and lets a waiting request win', async () => {
        await render({ preview: preview(), unseen: true })
        expect(dots()[0]?.className).toContain('bg-brand')
        await render({ agent: agent({ status: 'waiting_human' }), preview: preview(), unseen: true })
        expect(dots()).toHaveLength(1)
        expect(dots()[0]?.className).toContain('bg-orange-400')
    })

    it('says something went wrong, in red', async () => {
        await render({ agent: agent({ status: 'error' }), preview: preview() })
        expect(lineOf('Something went wrong')?.className).toContain('text-destructive')
    })

    it('says what a working coworker works on', async () => {
        await render({ agent: agent({ status: 'working' }), preview: preview() })
        expect(lineOf('Working · Q4 prospects')).toBeDefined()
    })

    it('opens the coworker on a click and says which one is open', async () => {
        await render({ selected: true, preview: preview() })
        const open = container.querySelector<HTMLButtonElement>('button[aria-current="true"]')
        expect(open).not.toBeNull()
        await act(async () => open!.click())
        expect(onOpen).toHaveBeenCalledOnce()
    })

    it('offers its actions behind a button named after the coworker', async () => {
        await render({ preview: preview() })
        expect(container.querySelector('button[aria-label="More for Scout"]')).not.toBeNull()
    })
})
