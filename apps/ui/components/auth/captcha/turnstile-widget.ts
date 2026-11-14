import { CaptchaError } from '@/components/auth/captcha/captcha-error'
import type { CaptchaWidget, Waiter } from '@/components/auth/captcha/captcha-widget'
import { scriptLoader } from '@/components/auth/captcha/load-script'

type TurnstileOptions = {
    sitekey: string
    execution: 'execute'
    appearance: 'interaction-only'
    callback: (token: string) => void
    'error-callback': (code: string) => void
    'timeout-callback': () => void
    'unsupported-callback': () => void
    'before-interactive-callback': () => void
    'after-interactive-callback': () => void
}

type TurnstileApi = {
    render: (container: HTMLElement, options: TurnstileOptions) => string
    execute: (widgetId: string) => void
    reset: (widgetId: string) => void
    remove: (widgetId: string) => void
}

type Rendered = { api: TurnstileApi; id: string }

declare global {
    interface Window {
        turnstile?: TurnstileApi
    }
}

const loadTurnstile = scriptLoader({
    src: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
    readApi: () => window.turnstile,
    failure: () => new CaptchaError('turnstile', 'captcha_failed', 'script'),
})

export function mountTurnstile(container: HTMLElement, siteKey: string, onInteractive: (interactive: boolean) => void, silentTimeoutMs: number): CaptchaWidget {
    let waiter: Waiter | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    let removed = false
    let rendered: Promise<Rendered | null> | null = null

    const stopTimeout = () => {
        if (timeout) clearTimeout(timeout)
        timeout = null
    }

    const settle = (token: string | null, reason: CaptchaError['reason'] = 'captcha_failed', code?: string) => {
        stopTimeout()
        if (token) waiter?.resolve(token)
        else waiter?.reject(new CaptchaError('turnstile', reason, code))
        waiter = null
    }

    const render = () =>
        (rendered ??= loadTurnstile().then(
            api => {
                if (removed) return null
                const id = api.render(container, {
                    sitekey: siteKey,
                    execution: 'execute',
                    appearance: 'interaction-only',
                    callback: token => settle(token),
                    'error-callback': code => settle(null, 'captcha_failed', String(code)),
                    'timeout-callback': () => settle(null, 'captcha_timeout', 'interactive_timeout'),
                    'unsupported-callback': () => settle(null, 'captcha_failed', 'unsupported'),
                    'before-interactive-callback': () => {
                        stopTimeout()
                        onInteractive(true)
                    },
                    'after-interactive-callback': () => onInteractive(false),
                })
                return { api, id }
            },
            () => {
                rendered = null
                return null
            }
        ))
    void render()

    return {
        getToken: () => {
            settle(null, 'captcha_failed', 'superseded')
            return new Promise<string>((resolve, reject) => {
                waiter = { resolve, reject }
                timeout = setTimeout(() => settle(null, 'captcha_timeout'), silentTimeoutMs)
                void render().then(widget => {
                    if (!widget) return settle(null, 'captcha_failed', 'script')
                    widget.api.reset(widget.id)
                    widget.api.execute(widget.id)
                })
            })
        },
        remove: () => {
            removed = true
            settle(null, 'captcha_failed', 'superseded')
            void rendered?.then(widget => widget?.api.remove(widget.id))
        },
    }
}
