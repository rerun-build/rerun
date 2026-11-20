// @vitest-environment happy-dom
import { TooltipProvider } from '@/components/ui/tooltip'
import type { BoxConnection } from '@/lib/engine/types'
import { connectionSummarySchema } from '@moldwright/contracts'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModelBuckets } from './ModelBuckets'

const FILLER = Array.from({ length: 30 }, (_, i) => ({ id: `vendor/model-${i}`, label: `Vendor: Model ${i}` }))

function openrouter(discovered: { id: string; label: string }[], models: string[]): BoxConnection {
    return connectionSummarySchema.parse({ id: 'cnx-router', name: 'OpenRouter', provider: 'openrouter', models, createdAt: '', connected: true, discoveredModels: discovered.map(model => ({ ...model, contextWindow: 128_000 })) })
}

const LONG_LIST = [{ id: 'google/gemini-4-carbon', label: 'Google: Gemini 4 Carbon' }, { id: 'openai/gpt-6.2-alpha', label: 'OpenAI: GPT-6.2 Alpha' }, ...FILLER]
const LONG = openrouter(LONG_LIST, ['vendor/model-0', 'vendor/model-1'])

let root: Root | null = null
let container: HTMLElement | null = null

function render(connection: BoxConnection, onModelsChange = vi.fn()) {
    const element = () => createElement(TooltipProvider, null, createElement(ModelBuckets, { connection, defaultModel: 'vendor/model-0', onModelsChange }))
    if (!container) {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    }
    act(() => root!.render(element()))
    return onModelsChange
}

const searchField = () => container!.querySelector<HTMLInputElement>('input[aria-label="Search models"]')
const chipLabels = () => Array.from(container!.querySelectorAll('[data-model-id]')).map(chip => chip.getAttribute('data-model-id'))

function type(value: string) {
    const input = searchField()!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
        setter.call(input, value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    })
}

describe('ModelBuckets search', () => {
    afterEach(() => {
        act(() => root?.unmount())
        root = null
        container?.remove()
        container = null
    })

    it('finds a model by every typed word, in any order, against label and id', () => {
        render(LONG)
        type('carbon GEMINI')
        expect(chipLabels()).toEqual(['google/gemini-4-carbon'])
        type('gpt-6.2 openai')
        expect(chipLabels()).toEqual(['openai/gpt-6.2-alpha'])
        expect(container!.textContent).toContain('1 match')
    })

    it('shows everything when the field is empty and a short line when nothing matches', () => {
        render(LONG)
        expect(chipLabels()).toHaveLength(32)
        type('nothing-like-this')
        expect(chipLabels()).toHaveLength(0)
        expect(container!.textContent).toContain('No model matches')
        act(() => searchField()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
        expect(searchField()!.value).toBe('')
        expect(chipLabels()).toHaveLength(32)
    })

    it('turns on a model picked from a filtered list and keeps the filter', () => {
        const onModelsChange = render(LONG)
        type('gemini carbon')
        const turnOn = container!.querySelector<HTMLButtonElement>('button[aria-label="Turn on Google: Gemini 4 Carbon"]')!
        act(() => turnOn.click())
        expect(onModelsChange).toHaveBeenCalledWith(['vendor/model-0', 'vendor/model-1', 'google/gemini-4-carbon'])
        render(openrouter(LONG_LIST, ['vendor/model-0', 'vendor/model-1', 'google/gemini-4-carbon']), onModelsChange)
        expect(searchField()!.value).toBe('gemini carbon')
        expect(chipLabels()).toEqual(['google/gemini-4-carbon'])
    })

    it('shows the full name and id on hover', () => {
        render(LONG)
        expect(container!.querySelector('[data-model-id="openai/gpt-6.2-alpha"] [title]')!.getAttribute('title')).toBe('OpenAI: GPT-6.2 Alpha\nopenai/gpt-6.2-alpha')
    })

    it('has no search field for a short list', () => {
        render(openrouter(FILLER.slice(0, 5), ['vendor/model-0', 'vendor/model-1']))
        expect(searchField()).toBeNull()
        expect(chipLabels()).toHaveLength(5)
    })
})
