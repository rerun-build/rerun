'use client'

import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import { LinkedInIcon, WhatsAppIcon } from '@rerun/ui/experts'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { appInfo } from '@/lib/apps/catalog'
import type { AppSlug } from '@/lib/apps/types'

const MENU_GLYPHS: Record<AppSlug, ComponentType<{ className?: string }>> = { linkedin: LinkedInIcon, whatsapp: WhatsAppIcon }

// The workspace menu's own place for the paid apps it runs, each shown once it holds an account.
export function AppsMenuSection({ apps, onOpen }: { apps: AppSlug[]; onOpen: (slug: AppSlug) => void }) {
    const t = useTranslations('apps.menu')
    return (
        <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="pl-7.5 text-xs font-normal text-muted-foreground">{t('label')}</DropdownMenuLabel>
            {apps.map(slug => {
                const Glyph = MENU_GLYPHS[slug]
                return (
                    <DropdownMenuItem key={slug} onSelect={() => onOpen(slug)} className="gap-2">
                        <Glyph className="size-4 text-muted-foreground" />
                        {appInfo(slug).name}
                    </DropdownMenuItem>
                )
            })}
        </>
    )
}
