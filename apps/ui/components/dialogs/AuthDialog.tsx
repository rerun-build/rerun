'use client'

import { AuthShell } from '@/components/auth/AuthShell'
import { useAnonymousSignUp } from '@/components/auth/useAnonymousSignUp'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { OAuthRetryCopy } from '@/lib/auth/oauth-error'
import type { SignupSurface } from '@moldwright/analytics'
import { useTranslations } from 'next-intl'

type Variant = 'welcome' | 'build' | 'signin'

export function AuthDialog({ open, onOpenChange, variant = 'welcome', copy: override }: { open: boolean; onOpenChange: (open: boolean) => void; variant?: Variant; copy?: OAuthRetryCopy | null }) {
    const t = useTranslations('dialogs.auth')
    const blocking = variant === 'welcome'
    const surface: SignupSurface = variant === 'build' ? 'foreman_intake' : blocking ? 'welcome_wall' : 'signin_dialog'
    const { form, abandon, reset, movedOn } = useAnonymousSignUp({ surface, active: open, onEntered: () => onOpenChange(false) })
    const copy = override && !movedOn ? override : { title: t(`${variant}.title`), subtitle: t(`${variant}.subtitle`) }

    const handleOpenChange = (next: boolean) => {
        if (!next) {
            if (blocking) return
            abandon()
            reset()
        }
        onOpenChange(next)
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange} dismissible={!blocking}>
            <DialogContent
                className="gap-0 overflow-hidden bg-background p-0 sm:h-[min(42rem,90dvh)] sm:w-[min(92vw,34rem)] sm:max-w-none sm:rounded-2xl"
                showCloseButton={!blocking}
                onEscapeKeyDown={e => blocking && e.preventDefault()}
                onPointerDownOutside={e => blocking && e.preventDefault()}
                onInteractOutside={e => blocking && e.preventDefault()}
            >
                <AuthShell title={copy.title} subtitle={copy.subtitle} titleAs={DialogTitle} variant="dialog">
                    {form}
                </AuthShell>
            </DialogContent>
        </Dialog>
    )
}
