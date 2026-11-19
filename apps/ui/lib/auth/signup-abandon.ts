import type { AuthMethod } from '@/lib/auth/auth-method'
import type { SignupAbandonTrigger, SignupStep } from '@moldwright/analytics'

export type SignupLeaveEvent = 'hidden' | 'pagehide' | 'dismissed'

const CODE_PENDING: ReadonlySet<SignupStep> = new Set(['phone_code', 'email_code'])

export function abandonTrigger(event: SignupLeaveEvent, step: SignupStep): SignupAbandonTrigger | null {
    if (event === 'dismissed') return 'dismissed'
    if (event === 'pagehide') return 'page_left'
    return CODE_PENDING.has(step) ? null : 'tab_hidden'
}

export function signupStep(method: AuthMethod, codeSent = false): SignupStep {
    return codeSent ? `${method}_code` : method
}

export function createLeaveWatcher(leave: (event: SignupLeaveEvent) => void) {
    let unloading = false
    return {
        beforeUnload: () => {
            unloading = true
        },
        hidden: () => {
            const event: SignupLeaveEvent = unloading ? 'pagehide' : 'hidden'
            unloading = false
            leave(event)
        },
        visible: () => {
            unloading = false
        },
        pageHide: () => leave('pagehide'),
    }
}
