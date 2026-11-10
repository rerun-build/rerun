'use client'

import { ThemeToggle } from '@rerun/ui/theme'

import { SunMoonIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

// A plain row rather than a menu item: the segments take the click themselves, so picking a theme
// leaves the menu open on the result.
export function ThemeMenuRow() {
    const t = useTranslations('layout')
    return (
        <div className="flex items-center gap-2 px-1.5 py-1 text-sm text-muted-foreground">
            <SunMoonIcon className="size-4" />
            {t('theme')}
            <ThemeToggle className="ml-auto origin-right scale-90 shadow-none" />
        </div>
    )
}
