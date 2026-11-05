'use client'

import { BrainTopBar } from '@/components/brain/BrainTopBar'
import { WorkspacePublishedList } from '@/components/published/WorkspacePublishedList'
import { GlobeIcon } from '@/lib/icons'

export function BrainPublishedView() {
    return (
        <>
            <BrainTopBar crumbs={[{ label: 'Published', icon: GlobeIcon }]} />
            <div className="flex min-h-0 flex-1 flex-col border-t border-border">
                <WorkspacePublishedList />
            </div>
        </>
    )
}
