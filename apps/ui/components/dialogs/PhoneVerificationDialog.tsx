'use client'

import { AuthShell } from '@/components/auth/AuthShell'
import { PhoneVerificationStep } from '@/components/auth/PhoneVerificationStep'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useTranslations } from 'next-intl'

// The second wall of a signup: a new account enters the app once it has given a phone number or
// skipped the step. It is driven by the account's own state rather than by the form that created it,
// because an account is born through four doors (the typed code, the button in the email, Google,
// /auth) and only one of them comes back to a form. Escape and a click outside do nothing: the way
// past it without a number is "Skip for now", and the getting-started checklist asks for it again.
export function PhoneVerificationDialog({ open }: { open: boolean }) {
    const t = useTranslations('dialogs.phoneVerification')
    return (
        <Dialog open={open} dismissible={false}>
            <DialogContent
                className="gap-0 overflow-hidden bg-background p-0 sm:h-[min(42rem,90dvh)] sm:w-[min(92vw,34rem)] sm:max-w-none sm:rounded-2xl"
                showCloseButton={false}
                onEscapeKeyDown={event => event.preventDefault()}
                onPointerDownOutside={event => event.preventDefault()}
                onInteractOutside={event => event.preventDefault()}
            >
                <AuthShell title={t('title')} subtitle={t('subtitle')} titleAs={DialogTitle} variant="dialog">
                    <PhoneVerificationStep active={open} />
                </AuthShell>
            </DialogContent>
        </Dialog>
    )
}
