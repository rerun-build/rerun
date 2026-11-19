// @vitest-environment happy-dom
import { dropHydrationNoiseOnTranslatedPage } from '@moldwright/analytics/client'
import type { CaptureResult } from 'posthog-js'
import { afterEach, describe, expect, it } from 'vitest'

const HYDRATION_ERROR = 'Minified React error #418; visit https://react.dev/errors/418?args[]=HTML&args[]= for the full message'

function exceptionEvent(value: string) {
    return { uuid: 'e', event: '$exception', properties: { $exception_list: [{ type: 'Error', value }] } } as unknown as CaptureResult
}

afterEach(() => {
    document.documentElement.className = ''
    document.body.innerHTML = ''
})

describe('dropHydrationNoiseOnTranslatedPage', () => {
    it('drops a hydration mismatch on a page Chrome or Edge translated', () => {
        document.body.innerHTML = '<p><font style="vertical-align: inherit;">Bonjour</font></p>'
        expect(dropHydrationNoiseOnTranslatedPage(exceptionEvent(HYDRATION_ERROR))).toBeNull()
    })

    it('drops a hydration mismatch on a page Google Translate marked', () => {
        document.documentElement.className = 'translated-ltr'
        expect(dropHydrationNoiseOnTranslatedPage(exceptionEvent(HYDRATION_ERROR))).toBeNull()
    })

    it('keeps a hydration mismatch on an untranslated page', () => {
        document.body.innerHTML = '<p>Hello</p>'
        const event = exceptionEvent(HYDRATION_ERROR)
        expect(dropHydrationNoiseOnTranslatedPage(event)).toBe(event)
    })

    it('keeps any other error on a translated page', () => {
        document.body.innerHTML = '<font>Bonjour</font>'
        const event = exceptionEvent("TypeError: Cannot read properties of undefined (reading 'state')")
        expect(dropHydrationNoiseOnTranslatedPage(event)).toBe(event)
    })

    it('keeps an event that is not an exception', () => {
        document.body.innerHTML = '<font>Bonjour</font>'
        const event = { uuid: 'p', event: '$pageview', properties: {} } as unknown as CaptureResult
        expect(dropHydrationNoiseOnTranslatedPage(event)).toBe(event)
    })
})
