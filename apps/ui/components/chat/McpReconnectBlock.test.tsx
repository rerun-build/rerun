// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpReconnectBlock } from '@/components/chat/McpReconnectBlock'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, string>) => `${key}|${values?.name ?? ''}` }))

let root: Root | null = null
let host: HTMLElement | null = null

async function render(effect: 'next_call' | 'next_message') {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
        root?.render(createElement(McpReconnectBlock, { data: { name: 'github', effect } }))
    })
    return host.textContent ?? ''
}

afterEach(async () => {
    await act(async () => root?.unmount())
    host?.remove()
    root = null
    host = null
})

describe('McpReconnectBlock', () => {
    it('names the server and says it reconnected', async () => {
        const text = await render('next_call')
        expect(text).toContain('steps.mcpReconnected|github')
        expect(text).not.toContain('NextMessage')
    })

    it('says the reconnect takes effect on the next message for effect next_message', async () => {
        const text = await render('next_message')
        expect(text).toContain('steps.mcpReconnectedNextMessage|github')
    })
})
