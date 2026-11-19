'use client'

import { LastUsedBadge } from '@/components/auth/LastUsedBadge'
import { Button } from '@/components/ui/button'
import type { AuthMethod } from '@/lib/auth/auth-method'
import { useLastSignInMethod, type LastSignInMethod } from '@/lib/auth/last-sign-in'
import { MailIcon, Smartphone } from '@/lib/icons'
import { detectMobileOs } from '@/lib/in-app-browser'
import { StepTransition } from '@moldwright/ui/steps'
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
    phoneLeadsAlone?: boolean
    oauth: ReactNode
    phone?: (surroundings: PhoneSurroundings) => ReactNode
    email: (beforeEmail: ReactNode) => ReactNode
    onMethodChange?: (method: AuthMethod) => void
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
