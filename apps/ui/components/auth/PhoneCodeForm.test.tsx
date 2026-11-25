// @vitest-environment happy-dom
import { TooltipProvider } from '@/components/ui/tooltip'
import messages from '@rerun/i18n/messages/en/auth.json'
import { NextIntlClientProvider } from 'next-intl'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@rerun/ui/steps', () => ({ StepTransition: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/hooks/useErrorText', () => ({ useErrorText: () => () => '' }))

const { PhoneCodeForm } = await import('./PhoneCodeForm')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

describe('PhoneCodeForm', () => {
    it('shows the number the code was sent to as a button that goes back to change it', async () => {
        const steps: string[] = []
        await act(async () =>
            root.render(
                <NextIntlClientProvider locale="en" messages={{ auth: messages }}>
                    <TooltipProvider>
                        <PhoneCodeForm initialSent={{ phone: '6 12 34 56 78', country: 'FR', channel: 'whatsapp' }} sendCode={async () => {}} verifyCode={async () => {}} onStepChange={step => void steps.push(step)} />
                    </TooltipProvider>
                </NextIntlClientProvider>
            )
        )

        const capsule = [...container.querySelectorAll('button')].find(button => button.textContent?.includes('+33 6 12 34 56 78'))
        expect(capsule?.textContent).toContain('Use a different number')

        await act(async () => capsule?.click())
        expect(steps).toEqual(['phone'])
    })
})
