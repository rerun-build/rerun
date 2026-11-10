'use client'

import { CONSENT_ATTRIBUTE, type ConsentDecision, detectConsentStatus, writeConsentCookie } from '@rerun/contracts'
import { Cookie } from '../icons'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../cn'
import { Button, Icon, Stripes, useIsMobile } from '../primitives'
import { COOKIE_SETTINGS_EVENT } from './consent-events'
import { useKitTranslations } from '../locale'

type CookieBannerProps = {
    policyHref: string
    onGrant: () => void
    onRevoke?: () => void
    className?: string
}

const CONSENT_INSET = '--consent-inset'

// No close cross, no click outside, no Escape: "no choice" has to stay "no choice". Both buttons
// share a size, a width and a row, refusing having to cost exactly one click like accepting. Not a
// modal, so no focus trap either. Under sm the card flattens into a single full width row, because
// a bottom sheet owns that same corner of the screen there.
// Both layouts carry `pointer-events-auto`: an open Radix modal puts `pointer-events: none` on
// <body>, which the banner would otherwise inherit, leaving its buttons dead.
export function CookieBanner({ policyHref, onGrant, onRevoke, className }: CookieBannerProps) {
    const t = useKitTranslations()
    // Decided in an effect and never during the render: the landing is prerendered and served from
    // a CDN, so a banner rendered from the status would ship in the static HTML of every visitor.
    const [open, setOpen] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    // Safe to branch the markup on: nothing renders before the effect above has run client side.
    const isMobile = useIsMobile()

    useEffect(() => {
        if (detectConsentStatus() === 'pending') setOpen(true)
        const reopen = () => setOpen(true)
        window.addEventListener(COOKIE_SETTINGS_EVENT, reopen)
        return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, reopen)
    }, [])

    // Radix dismisses a layer from a `pointerdown` listener on the document, so a click on the
    // banner would close whatever dialog or popover is open underneath it. Stopping the native
    // event on the banner itself keeps it from ever reaching the document; a React handler would
    // not, the App Router mounts the React root on the document too.
    useEffect(() => {
        const node = ref.current
        if (!node) return
        const swallow = (event: PointerEvent) => event.stopPropagation()
        node.addEventListener('pointerdown', swallow)
        return () => node.removeEventListener('pointerdown', swallow)
    }, [open])

    // The bar owns the bottom of the screen on mobile, where a sheet would otherwise render right
    // under it. Publishing its measured height lets those layers sit on top of it instead. Floating
    // in a corner on desktop, it overlaps nothing and claims no inset.
    useEffect(() => {
        const node = ref.current
        if (!node || !isMobile) return
        const publish = () => document.documentElement.style.setProperty(CONSENT_INSET, `${node.offsetHeight}px`)
        publish()
        const observer = new ResizeObserver(publish)
        observer.observe(node)
        return () => {
            observer.disconnect()
            document.documentElement.style.removeProperty(CONSENT_INSET)
        }
    }, [open, isMobile])

    if (!open) return null

    const decide = (decision: ConsentDecision) => {
        writeConsentCookie(decision)
        document.documentElement.setAttribute(CONSENT_ATTRIBUTE, decision)
        setOpen(false)
        if (decision === 'granted') onGrant()
        else onRevoke?.()
    }

    const actions = (
        <>
            <Button
                variant="outline"
                size={isMobile ? 'sm' : 'lg'}
                className={isMobile ? undefined : 'flex-1'}
                onClick={() => decide('denied')}
            >
                {t('consent.rejectAll')}
            </Button>
            <Button
                size={isMobile ? 'sm' : 'lg'}
                className={isMobile ? undefined : 'flex-1'}
                onClick={() => decide('granted')}
            >
                {t('consent.acceptAll')}
            </Button>
        </>
    )

    const policy = (chunks: ReactNode) => (
        <a href={policyHref} className="text-foreground underline underline-offset-4">
            {chunks}
        </a>
    )

    if (isMobile) {
        return (
            <div
                ref={ref}
                role="region"
                aria-label={t('consent.region')}
                className={cn(
                    'pointer-events-auto fixed inset-x-0 bottom-0 z-60 border-t border-border bg-background/95 backdrop-blur-md',
                    'flex items-center gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
                    'animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out',
                    className,
                )}
            >
                <Icon size="xs" icon={Cookie} />
                <p className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
                    {t.rich('consent.short', { policy })}
                </p>
                <div className="flex shrink-0 gap-2">{actions}</div>
            </div>
        )
    }

    return (
        <div
            ref={ref}
            role="region"
            aria-label={t('consent.region')}
            className={cn(
                'pointer-events-auto fixed bottom-4 left-4 z-60 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur-md',
                'mb-[env(safe-area-inset-bottom)] animate-in fade-in slide-in-from-bottom-4 duration-500 ease-out',
                className,
            )}
        >
            <div className="relative flex items-center gap-2 px-4 pt-3 pb-2">
                <Stripes fade="bottom" />
                <Icon size="xs" icon={Cookie} className="relative" />
                <span className="relative text-xs font-medium">{t('consent.title')}</span>
            </div>
            <div className="flex flex-col gap-3 px-4 pt-1 pb-4">
                <p className="text-xs leading-relaxed text-muted-foreground">
                    {t.rich('consent.long', { policy })}
                </p>
                <div className="flex gap-2">{actions}</div>
            </div>
        </div>
    )
}
