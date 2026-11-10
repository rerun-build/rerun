// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { Refusal } from '@/hooks/useErrorText'

vi.mock('next-intl', async () => {
    const { createTranslator } = await import('use-intl')
    const { loadMessages } = await import('@rerun/i18n/messages')
    const translator = createTranslator({ locale: 'fr', messages: await loadMessages('fr'), namespace: 'errors' })
    return { useTranslations: () => translator }
})

const { useErrorText } = await import('@/hooks/useErrorText')

function textOf(refusal: Refusal, fallback?: string): string {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    let text = ''
    function Probe() {
        text = useErrorText()(refusal, fallback)
        return null
    }
    const root = createRoot(document.createElement('div'))
    act(() => root.render(createElement(Probe)))
    act(() => root.unmount())
    return text
}

describe('useErrorText', () => {
    it('says a refusal with a code in the reader language', () => {
        expect(textOf({ error: 'This workspace has no active plan.', code: 'noActivePlan' })).toBe("Ce workspace n'a pas d'abonnement actif.")
        expect(textOf({ error: 'Keep the name under 40 characters', code: 'nameTooLong', params: { max: 40 } })).toBe('Le nom doit faire moins de 40 caractères')
    })

    it('keeps the server text for a refusal without a code, or with a code the catalog does not know', () => {
        expect(textOf({ error: 'Linkup is down' })).toBe('Linkup is down')
        expect(textOf({ error: 'Pick a free slot first', code: 'aCodeFromANewerServer' })).toBe('Pick a free slot first')
    })

    it('falls back when the refusal carries no text', () => {
        expect(textOf({}, 'Could not save')).toBe('Could not save')
        expect(textOf({})).toBe('Une erreur est survenue. Veuillez réessayer.')
    })
})
