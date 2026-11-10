'use client'

import { landingUrl } from '@/lib/site'
import { cn } from '@/lib/utils'
import { Logo } from '@rerun/ui/logo'
import type { ElementType, ReactNode } from 'react'
import { AuthScene } from './AuthScene'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { useTranslations } from 'next-intl'

// Le cadre commun à toutes les entrées de compte : la scène iso occupe tout le fond, le
// formulaire flotte au centre sans carte, l'en-tête (logo, titre, sous-titre) centré au-dessus,
// et les mentions ferment le bas.
//
// `titleAs` existe pour la dialog : Radix exige que le titre soit son propre DialogTitle, alors
// que la page /auth veut un h1. Le style reste écrit une seule fois, ici.
//
// `variant` distingue les deux cadres. Les deux sont peints en `--background` : la dialog rejoue
// la page telle quelle, décor compris, et un `--popover` plus clair y trahirait la carte. Seules
// les mentions diffèrent, la page devant rester au-dessus de la barre de consentement quand la
// dialog la gère déjà elle-même (`bottom-[var(--consent-inset)]` en bottom sheet).
export function AuthShell({
    title,
    subtitle,
    titleAs: Title = 'h1',
    variant = 'page',
    children,
}: {
    title: ReactNode
    subtitle: ReactNode
    titleAs?: ElementType
    variant?: 'page' | 'dialog'
    children: ReactNode
}) {
    const isDialog = variant === 'dialog'

    return (
        <div className="relative isolate flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground selection:bg-primary/20">
            <AuthScene variant={variant} />

            <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-6 py-6 sm:py-10">
                <div className="mx-auto w-full max-w-sm space-y-6">
                    <div className="flex flex-col items-center space-y-4 text-center">
                        <Logo size="md" />
                        <div className="space-y-2">
                            <Title className="text-3xl font-medium tracking-tight text-balance sm:text-4xl">{title}</Title>
                            <p className="text-base text-muted-foreground text-balance">{subtitle}</p>
                        </div>
                    </div>
                    {children}
                </div>
            </div>

            <p
                className={cn(
                    'relative z-10 shrink-0 px-6 text-center text-xs text-muted-foreground',
                    isDialog ? 'pb-[max(1.5rem,env(safe-area-inset-bottom))]' : 'pb-[calc(var(--consent-inset)+max(1.5rem,env(safe-area-inset-bottom)))]'
                )}
            >
                <AuthTerms />
            </p>
        </div>
    )
}

export function AuthTerms() {
    const t = useTranslations('auth')
    // A self-hosted install has its own terms, if any: Rerun's do not bind its users.
    if (!RERUN_CLOUD) return null
    return t.rich('terms', {
        terms: chunks => (
            <a href={landingUrl('/terms')} target="_blank" rel="noreferrer" className="underline underline-offset-4 transition-colors hover:text-foreground">
                {chunks}
            </a>
        ),
        privacy: chunks => (
            <a href={landingUrl('/privacy')} target="_blank" rel="noreferrer" className="underline underline-offset-4 transition-colors hover:text-foreground">
                {chunks}
            </a>
        ),
    })
}
