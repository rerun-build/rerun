'use client'

import { BrainTopBar } from '@/components/brain/BrainTopBar'
import { WorkspacePublishedList } from '@/components/published/WorkspacePublishedList'
import { GlobeIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

export function BrainPublishedView() {
    const t = useTranslations('brain.crumbs')
    return (
        <>
            <BrainTopBar crumbs={[{ label: t('published'), icon: GlobeIcon }]} />
            <div className="flex min-h-0 flex-1 flex-col border-t border-border">
                <WorkspacePublishedList />
            </div>
        </>
    )
}
