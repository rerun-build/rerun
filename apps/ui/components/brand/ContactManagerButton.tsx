'use client'

import type { WorkspaceManager } from '@/components/brand/useWorkspaceManager'
import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'
import type { ComponentProps } from 'react'

export function ContactManagerButton({ manager, ...props }: { manager: WorkspaceManager } & Omit<ComponentProps<typeof Button>, 'asChild' | 'children'>) {
    const t = useTranslations('managed')
    if (!manager.supportEmail || !manager.name) return null
    return (
        <Button {...props} asChild>
            <a href={`mailto:${manager.supportEmail}`}>{t('contact', { manager: manager.name })}</a>
        </Button>
    )
}
