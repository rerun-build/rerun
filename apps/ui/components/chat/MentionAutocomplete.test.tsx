// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentionAgent, MentionTrigger } from './MentionAutocomplete'

// The composer told only its symbols: `@`, `/` and `#` now open a menu that says what each does,
// and a bare symbol with nothing behind it says so instead of showing nothing.

vi.mock('@rerun/ui/iso-grid', () => ({ AgentBuddy: () => null }))
vi.mock('@rerun/ui/foreman', () => ({ Orb: () => null }))
vi.mock('@/components/computers/ComputerBits', () => ({ ComputerHandle: () => null, ComputerStatusBadge: () => null, OsTile: () => null }))

const { useMentionAutocomplete } = await import('./MentionAutocomplete')

const AGENTS: MentionAgent[] = [{ id: 'scout', name: 'Scout', handle: 'scout' }]
const SKILLS = [{ slug: 'weekly-report', name: 'Weekly report' }]

let container: HTMLDivElement
let root: Root
const written: string[] = []

type HarnessProps = { agents?: MentionAgent[]; skills?: typeof SKILLS | null; computers?: [] | null; triggers?: MentionTrigger[] }

function Harness({ agents = AGENTS, skills = SKILLS, computers = [], triggers }: HarnessProps) {
    const { menu, inputRef, textareaProps, commands } = useMentionAutocomplete(agents, skills, text => written.push(text), computers, undefined, triggers)
    return createElement('div', null, menu, createElement('textarea', { ref: inputRef, ...textareaProps }), createElement('button', { type: 'button', onClick: () => commands.onPick('/') }))
}

function mount(props: HarnessProps = {}) {
    act(() => root.render(createElement(Harness, props)))
}

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    written.length = 0
    mount()
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const field = () => container.querySelector('textarea') as HTMLTextAreaElement

function type(text: string) {
    const el = field()
    act(() => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, text)
        el.setSelectionRange(text.length, text.length)
        el.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

function press(key: string) {
    act(() => {
        field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    })
}

const menuText = () => container.textContent ?? ''

describe('useMentionAutocomplete', () => {
    it('heads the list with what the symbol does', () => {
        type('Can you ask @')
        expect(menuText()).toContain('Coworkers')
        expect(menuText()).toContain('Bring a coworker into this conversation')
        expect(container.querySelectorAll('[role="option"]')).toHaveLength(1)
    })

    it('says there is no computer when a bare # has none to offer', () => {
        type('Open the report on #')
        expect(menuText()).toContain('Let your coworker work on a linked computer')
        expect(menuText()).toContain('No computer linked yet')
        expect(container.querySelector('[role="option"]')).toBeNull()
    })

    it('stays shut on a hashtag that names no computer', () => {
        type('Post it with #marketing')
        expect(menuText()).toBe('')
    })

    it('closes on Escape, even with nothing to pick', () => {
        type('#')
        expect(menuText()).toContain('No computer linked yet')
        press('Escape')
        expect(menuText()).toBe('')
    })

    it('stays shut after Escape until the text or the caret moves', () => {
        type('#')
        press('Escape')
        act(() => {
            field().dispatchEvent(new Event('select', { bubbles: true }))
        })
        expect(menuText()).toBe('')
        type('# @')
        expect(menuText()).toContain('Coworkers')
    })

    it('types a symbol at the caret, spaced from the word before it, and opens its menu', () => {
        type('hello')
        act(() => container.querySelector('button')?.click())
        expect(field().value).toBe('hello /')
        expect(written.at(-1)).toBe('hello /')
        expect(menuText()).toContain('Run a saved how-to your coworker knows')
        expect(menuText()).toContain('Weekly report')
    })

    it('leaves a symbol the composer does not serve as plain text', () => {
        mount({ triggers: ['@', '#'] })
        type('Run /')
        expect(menuText()).toBe('')
        type('Run @')
        expect(menuText()).toContain('Coworkers')
    })

    it('says what a symbol does, without claiming nothing is there, while its list is not read', () => {
        mount({ skills: null, computers: null })
        type('/')
        expect(menuText()).toContain('Run a saved how-to your coworker knows')
        expect(menuText()).not.toContain('This coworker has no skill yet')
        type('#')
        expect(menuText()).toContain('Let your coworker work on a linked computer')
        expect(menuText()).not.toContain('No computer linked yet')
    })

    it('opens the list on the Chief of Staff, mentioned by its fixed id whatever its name', () => {
        const foreman: MentionAgent = { id: 'foreman', name: 'Maya', handle: 'foreman', hint: 'Chief of Staff', look: 'orb' }
        mount({ agents: [{ id: 'ada', name: 'Ada', handle: 'ada', preferred: true }, ...AGENTS, foreman] })
        type('Ask @')
        const options = [...container.querySelectorAll('[role="option"]')].map(option => option.textContent)
        expect(options).toHaveLength(3)
        expect(options[0]).toContain('Maya')
        expect(options[0]).toContain('Chief of Staff')
        expect(options[1]).toContain('Ada')
        press('Enter')
        expect(field().value).toBe('Ask @foreman ')
    })

    it('finds a named Chief of Staff by its role', () => {
        mount({ agents: [...AGENTS, { id: 'foreman', name: 'Maya', handle: 'foreman', hint: 'Chief of Staff', look: 'orb' }] })
        type('@chief')
        expect([...container.querySelectorAll('[role="option"]')].map(option => option.textContent)).toEqual([expect.stringContaining('Maya')])
    })
})
