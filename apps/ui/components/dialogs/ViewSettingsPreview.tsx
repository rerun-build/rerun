'use client'

import type { TableCard as TableCardData } from '@rerun/contracts'
import { TableCard, type FileUrl } from '@rerun/ui/chat'
import { useTranslations } from 'next-intl'

// The view drawn as the agent would send it in chat, from the rows already on screen.
export function ViewSettingsPreview({ card, fileUrl }: { card: TableCardData; fileUrl?: FileUrl }) {
    const t = useTranslations('dialogs.viewSettings')
    return (
        <div className="hidden h-full flex-col justify-center gap-3 overflow-y-auto border-l bg-muted/30 p-8 sm:flex">
            <p className="text-xs font-medium text-muted-foreground">{t('preview')}</p>
            <TableCard card={card} fileUrl={fileUrl} />
        </div>
    )
}
