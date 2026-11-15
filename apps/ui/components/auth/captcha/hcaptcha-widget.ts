import { CaptchaError } from '@/components/auth/captcha/captcha-error'
import type { CaptchaWidget, Waiter } from '@/components/auth/captcha/captcha-widget'
import { scriptLoader } from '@/components/auth/captcha/load-script'

type HcaptchaOptions = {
    sitekey: string
    theme: 'light' | 'dark'
    size: 'normal' | 'compact'
    callback: (token: string) => void
    'error-callback': (code: string) => void
}

type HcaptchaApi = {
    render: (container: HTMLElement, options: HcaptchaOptions) => string
    reset: (widgetId: string) => void
    remove: (widgetId: string) => void
}

type Rendered = { api: HcaptchaApi; id: string }

declare global {
    interface Window {
        hcaptcha?: HcaptchaApi
    }
}

const READY_CALLBACK = 'rerunHcaptchaReady'

const loadHcaptcha = scriptLoader({
    src: `https://js.hcaptcha.com/1/api.js?render=explicit&recaptchacompat=off&onload=${READY_CALLBACK}`,
    readApi: () => window.hcaptcha,
    failure: () => new CaptchaError('hcaptcha', 'captcha_failed', 'script'),
    readyCallback: READY_CALLBACK,
})

const COMPACT_BELOW_PX = 360

export function mountHcaptcha(container: HTMLElement, siteKey: string, theme: HcaptchaOptions['theme'], scriptTimeoutMs: number): CaptchaWidget {
    let waiter: Waiter | null = null
    let timeout: ReturnType<typeof setTimeout> | null = null
    let removed = false
    let answered = false
    let rendered: Promise<Rendered | null> | null = null

    const stopTimeout = () => {
        if (timeout) clearTimeout(timeout)
        timeout = null
    }

    const settle = (token: string | null, reason: CaptchaError['reason'] = 'captcha_failed', code?: string) => {
        stopTimeout()
        if (token) waiter?.resolve(token)
        else waiter?.reject(new CaptchaError('hcaptcha', reason, code))
        waiter = null
    }

    const render = () =>
        (rendered ??= loadHcaptcha().then(
            api => {
                if (removed) return null
                const id = api.render(container, {
                    sitekey: siteKey,
                    theme,
                    size: (container.parentElement ?? container).clientWidth < COMPACT_BELOW_PX ? 'compact' : 'normal',
                    callback: token => {
                        answered = true
                        settle(token)
                    },
                    'error-callback': code => {
                        answered = true
                        settle(null, 'captcha_failed', String(code))
                    },
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
                timeout = setTimeout(() => settle(null, 'captcha_timeout', 'script'), scriptTimeoutMs)
                void render().then(widget => {
                    stopTimeout()
                    if (!widget) return settle(null, 'captcha_failed', 'script')
                    if (answered) widget.api.reset(widget.id)
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
