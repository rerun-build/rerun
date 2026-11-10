'use client'

import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'

import { cn } from '../cn'
import { Monitor, Moon, Sun, type LucideIcon } from '../icons'
import { SegmentedControl, SegmentedControlItem } from '../primitives/segmented-control'
import type { ThemePreference } from './theme-cookie'
import { useKitTranslations } from '../locale'

const OPTIONS: { value: ThemePreference; icon: LucideIcon }[] = [
    { value: 'system', icon: Monitor },
    { value: 'light', icon: Sun },
    { value: 'dark', icon: Moon },
]

export function ThemeToggle({ className }: { className?: string }) {
    const t = useKitTranslations()
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)

    // Le thème résolu n'existe pas au SSR : aucun segment n'est actif tant que le client n'a pas
    // hydraté, sinon le premier rendu en désigne un au hasard.
    useEffect(() => setMounted(true), [])

    return (
        <SegmentedControl
            value={mounted ? (theme ?? 'system') : ''}
            onValueChange={setTheme}
            className={cn('gap-0.5 p-0.5', className)}
            role="radiogroup"
            aria-label={t('theme.label')}
        >
            {OPTIONS.map(({ value, icon: Glyph }) => (
                <SegmentedControlItem key={value} value={value} className="inline-flex size-7 items-center justify-center p-0" aria-label={t(`theme.options.${value}`)} title={t(`theme.options.${value}`)}>
                    <Glyph className="size-4" />
                </SegmentedControlItem>
            ))}
        </SegmentedControl>
    )
}
