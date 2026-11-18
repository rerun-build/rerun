// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { HitlReply } from '@/lib/chat-hitl'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const messages = await loadMessages('en')
    return { useLocale: () => 'en', useTranslations: (namespace: string) => createTranslator({ locale: 'en', messages, namespace: namespace as never }) }
})

vi.mock('@/app/api/_actions/services.actions', () => ({ getServiceAlternativesAction: async () => ({}) }))
vi.mock('@/hooks/useCatalogServices', () => ({ useCatalogServices: () => ({ resolved: new Map(), loading: false }) }))
vi.mock('@/hooks/useConnectorServices', () => ({ useConnectorServices: () => ({ custom: [] }) }))
vi.mock('@/components/chat/MessageAttachments', () => ({ MessageAttachments: () => null }))
vi.mock('@/components/chat/spend/SpendReceipt', () => ({ SpendReceipt: () => null }))

const { HitlReceipt } = await import('./HitlReceipt')

type ComputerReply = Extract<HitlReply, { kind: 'computer' }>

const allowed = (extra: Partial<ComputerReply> = {}): ComputerReply => ({ kind: 'computer', computer: 'clements-macbook-pro', decision: 'approved', ...extra })
const call = (input: Record<string, unknown>) => ({ type: 'tool-request_computer_access', toolName: 'request_computer_access', input: { computer: 'clements-macbook-pro', reason: 'Check the system', ...input } })

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

function render(reply: ComputerReply, callPart?: ReturnType<typeof call>) {
    act(() => root.render(createElement(HitlReceipt, { reply, call: callPart })))
}

const text = (element: Element | null | undefined) => element?.textContent?.replace(/\s+/g, ' ').trim()
const badge = () => text(container.querySelector('span.ml-auto'))
const lines = () => [...container.querySelectorAll('code')].map(code => code.textContent)
const highlighted = () => [...container.querySelectorAll('mark')].map(mark => mark.textContent)

describe('the receipt of a computer access', () => {
    it('heads a card with the computer and what was decided, one line per command', () => {
        render(allowed(), call({ commands: ['sw_vers'] }))
        expect(text(container)).toContain('#clements-macbook-pro')
        expect(badge()).toBe('Allowed')
        expect(lines()).toEqual(['sw_vers'])
    })

    it('lists every command of the request', () => {
        render(allowed(), call({ commands: ['sw_vers', 'system_profiler SPHardwareDataType', 'df -h /'] }))
        expect(lines()).toEqual(['sw_vers', 'system_profiler SPHardwareDataType', 'df -h /'])
    })

    it('strikes a denied command', () => {
        render(allowed({ decision: 'declined' }), call({ commands: ['rm -rf ~/Downloads/*.tmp'] }))
        expect(badge()).toBe('Denied')
        expect(container.querySelector('code')?.className).toContain('line-through')
    })

    it('highlights the program an Always rule keeps', () => {
        render(allowed({ always: 'ffmpeg' }), call({ commands: ['ffmpeg -i day2.mov teaser.mp4'] }))
        expect(badge()).toBe('Always allowed')
        expect(highlighted()).toEqual(['ffmpeg'])
        expect(lines()).toEqual(['ffmpeg -i day2.mov teaser.mp4'])
    })

    it('does not highlight a rule that only starts the program name', () => {
        render(allowed({ always: 'ff' }), call({ commands: ['ffmpeg -i day2.mov teaser.mp4'] }))
        expect(highlighted()).toEqual([])
    })

    it('lists the full paths of a file access and highlights the folder kept', () => {
        render(allowed({ always: '~/Documents/Factures' }), call({ paths: ['~/Documents/Factures/2026-10.pdf', '~/Documents/Factures/2026-11.pdf'] }))
        expect(lines()).toEqual(['~/Documents/Factures/2026-10.pdf', '~/Documents/Factures/2026-11.pdf'])
        expect(highlighted()).toEqual(['~/Documents/Factures', '~/Documents/Factures'])
    })

    it('names the screen, mouse and keyboard for a screen access', () => {
        render(allowed(), call({ screen: true }))
        expect(text(container)).toContain('Screen, mouse and keyboard')
        expect(lines()).toEqual([])
    })

    it('keeps the computer and the decision when the thread no longer holds the request', () => {
        render(allowed())
        expect(text(container)).toBe('#clements-macbook-proAllowed')
        expect(lines()).toEqual([])
    })
})
