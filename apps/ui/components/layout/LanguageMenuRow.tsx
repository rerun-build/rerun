'use client'

import { SHOW_PSEUDO, type LanguageChoice } from '@/components/account/LanguagePanel'
import { useLanguageChoice } from '@/components/account/useLanguageChoice'
import { useLanguagePacksEnabled } from '@/components/layout/FeatureFlagsProvider'
import { DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu'
import { Languages } from '@/lib/icons'
import { localeNativeName, PSEUDO_LOCALE, stableLocales } from '@rerun/i18n'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

const AUTOMATIC = 'auto'
const SUBMENU_WIDTH = 160 // w-40
const VIEWPORT_MARGIN = 8

export function LanguageMenuRow() {
    const enabled = useLanguagePacksEnabled()
    if (!enabled) return null
    return <LanguageMenu />
}

function LanguageMenu() {
    const t = useTranslations('layout')
    const tLanguage = useTranslations('account.language')
    const { value, change } = useLanguageChoice()
    const [pending, setPending] = useState<LanguageChoice | undefined>(undefined)
    const triggerRef = useRef<HTMLDivElement>(null)
    const [sideOffset, setSideOffset] = useState(0)
    const shown = pending === undefined ? value : pending
    const shownName = shown === null ? tLanguage('automatic') : shown === PSEUDO_LOCALE ? 'Pseudo' : localeNativeName(shown)

    const pick = async (next: string) => {
        const choice = next === AUTOMATIC ? null : (next as LanguageChoice)
        if (choice === value) return
        setPending(choice)
        try {
            await change(choice)
        } finally {
            setPending(undefined)
        }
    }

    // On a phone the menu leaves no room on its right: the list slides back over it instead of off screen.
    const placeSubmenu = (open: boolean) => {
        const right = triggerRef.current?.getBoundingClientRect().right
        if (!open || right === undefined) return
        setSideOffset(Math.min(0, window.innerWidth - right - SUBMENU_WIDTH - VIEWPORT_MARGIN))
    }

    return (
        <DropdownMenuSub onOpenChange={placeSubmenu}>
            <DropdownMenuSubTrigger ref={triggerRef} className="gap-2 text-muted-foreground">
                <Languages className="size-4" />
                <span className="flex-1">{t('language')}</span>
                <span className="truncate text-xs">{shownName}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent sideOffset={sideOffset} className="w-40">
                <DropdownMenuRadioGroup value={shown ?? AUTOMATIC} onValueChange={next => void pick(next)}>
                    <DropdownMenuRadioItem value={AUTOMATIC} disabled={pending !== undefined}>
                        {tLanguage('automatic')}
                    </DropdownMenuRadioItem>
                    {stableLocales().map(locale => (
                        <DropdownMenuRadioItem key={locale} value={locale} lang={locale} disabled={pending !== undefined}>
                            {localeNativeName(locale)}
                        </DropdownMenuRadioItem>
                    ))}
                    {SHOW_PSEUDO && (
                        <DropdownMenuRadioItem value={PSEUDO_LOCALE} disabled={pending !== undefined}>
                            Pseudo ({PSEUDO_LOCALE})
                        </DropdownMenuRadioItem>
                    )}
                </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    )
}
