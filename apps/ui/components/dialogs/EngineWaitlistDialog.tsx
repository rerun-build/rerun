'use client'

import { accountLabel } from '@/lib/auth/placeholder-email'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useSession } from '@/supabase/session/SessionProvider'

// The wall an account meets when the pool has no machine left for it. Same frame and same locks as
// the welcome wall: nothing behind it is actionable, and there is nothing to click through, because
// the only way out is a machine freeing up, which the next page load sees on its own. Signing out
// stays possible so a wrong account is not trapped behind it.
export function EngineWaitlistDialog({ open }: { open: boolean }) {
    const t = useTranslations('dialogs.engineWaitlist')
    const { session, signOut } = useSession()
    const email = accountLabel(session?.user?.email)
    const [signingOut, setSigningOut] = useState(false)

    const leave = async () => {
        setSigningOut(true)
        await signOut()
    }

    return (
        <Dialog open={open} dismissible={false}>
            <DialogContent className="gap-0 overflow-hidden bg-background p-0 sm:h-[min(42rem,90dvh)] sm:w-[min(92vw,34rem)] sm:max-w-none sm:rounded-2xl" showCloseButton={false} onEscapeKeyDown={e => e.preventDefault()} onPointerDownOutside={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}>
                <AuthShell title={t('title')} subtitle={t('subtitle')} titleAs={DialogTitle} variant="dialog">
                    <div className="space-y-4 text-center">
                        {email && (
                            <p className="text-sm text-muted-foreground">
                                {t.rich('signedInAs', { email, b: chunks => <span className="font-medium text-foreground">{chunks}</span> })}
                            </p>
                        )}
                        <Button variant="link" className="text-muted-foreground" loading={signingOut} onClick={() => void leave()}>
                            {t('signOut')}
                        </Button>
                    </div>
                </AuthShell>
            </DialogContent>
        </Dialog>
    )
}
