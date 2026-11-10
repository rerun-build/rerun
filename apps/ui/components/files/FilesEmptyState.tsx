'use client'

import { Button } from '@/components/ui/button'
import { useTranslations } from 'next-intl'

import { FolderGlyph } from './FileGlyph'

type FilesEmptyStateProps = {
    description: string
    onGoUp?: () => void
}

export function FilesEmptyState({ description, onGoUp }: FilesEmptyStateProps) {
    const t = useTranslations('files.empty')
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <FolderGlyph />
            <div className="space-y-1">
                <p className="text-sm font-medium">{t('title')}</p>
                <p className="max-w-[36ch] text-xs text-muted-foreground">{description}</p>
            </div>
            {onGoUp && (
                <Button variant="outline" size="sm" onClick={onGoUp}>
                    {t('goUp')}
                </Button>
            )}
        </div>
    )
}
