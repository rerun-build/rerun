'use client'

import { LastUsedBadge } from '@/components/auth/LastUsedBadge'
import { Button } from '@/components/ui/button'
import type { AuthMethod } from '@/lib/auth/auth-method'
import { useLastSignInMethod, type LastSignInMethod } from '@/lib/auth/last-sign-in'
import { MailIcon, Smartphone } from '@/lib/icons'
import { detectMobileOs } from '@/lib/in-app-browser'
import { StepTransition } from '@rerun/ui/steps'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

function Divider({ children }: { children: ReactNode }) {
    return (
        <div className="flex items-center gap-2 text-xs uppercase">
            <span className="flex-1 border-t" />
            <span className="text-muted-foreground">{children}</span>
            <span className="flex-1 border-t" />
        </div>
    )
}

export type PhoneSurroundings = { beforePhone?: ReactNode; afterPhone?: ReactNode; phoneLastUsed?: boolean }

// The ways into an account, one form at a time with the others a tap away. The forms belong to the
// caller, which knows whether it signs in or upgrades an anonymous visitor: each is handed the
// other ways in to draw beside its own field. The number leads everywhere: alone at the top on a
// phone, where an in-app browser refuses Google, and under the providers on a computer.
export function AuthMethods({
    initialMethod = 'phone',
    phoneLeadsAlone,
    oauth,
    phone,
    email,
    onMethodChange,
    lastUsed,
}: {
    initialMethod?: AuthMethod
    // Left out where nothing is rendered on the server, and read from the browser instead.
    phoneLeadsAlone?: boolean
    // The provider buttons, Google and Apple. Null where none is configured.
    oauth: ReactNode
    // Absent where signing in by phone is not offered: the email form leads alone.
    phone?: (surroundings: PhoneSurroundings) => ReactNode
    email: (beforeEmail: ReactNode) => ReactNode
    // Switching remounts the form on its first step, which the form itself does not report.
    onMethodChange?: (method: AuthMethod) => void
    // Forced by the lab; read from this browser everywhere else. The provider buttons read it themselves.
    lastUsed?: LastSignInMethod | null
}) {
    const t = useTranslations('auth.methods')
    const remembered = useLastSignInMethod()
    const usedLast = lastUsed === undefined ? remembered : lastUsed
    const [method, setMethodState] = useState<AuthMethod>(phone ? initialMethod : 'email')
    const setMethod = (next: AuthMethod) => {
        setMethodState(next)
        onMethodChange?.(next)
    }
    const [numberOnTop] = useState(() => phoneLeadsAlone ?? detectMobileOs(navigator.userAgent) !== null)

    const emailButton = (
        <Button variant="outline" className="w-full gap-2" onClick={() => setMethod('email')}>
            <MailIcon className="size-4" />
            {t('email')}
            {usedLast === 'email' && <LastUsedBadge />}
        </Button>
    )

    return (
        <StepTransition stepKey={method} direction={method === 'phone' ? -1 : 1}>
            {method === 'phone' && phone
                ? phone(
                      numberOnTop
                          ? {
                                phoneLastUsed: usedLast === 'phone',
                                afterPhone: (
                                    <>
                                        <Divider>{t('or')}</Divider>
                                        {oauth}
                                        {emailButton}
                                    </>
                                ),
                            }
                          : {
                                phoneLastUsed: usedLast === 'phone',
                                beforePhone: (
                                    <>
                                        {oauth}
                                        {emailButton}
                                        <Divider>{t('orContinueWith')}</Divider>
                                    </>
                                ),
                            }
                  )
                : email(
                      <>
                          {oauth}
                          {phone && (
                              <Button variant="outline" className="w-full gap-2" onClick={() => setMethod('phone')}>
                                  <Smartphone className="size-4" />
                                  {t('phone')}
                                  {usedLast === 'phone' && <LastUsedBadge />}
                              </Button>
                          )}
                          {(oauth || phone) && <Divider>{t('orContinueWith')}</Divider>}
                      </>
                  )}
        </StepTransition>
    )
}
