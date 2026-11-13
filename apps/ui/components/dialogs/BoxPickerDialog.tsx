'use client'

import { useTranslations } from 'next-intl'
import { useMemo } from 'react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PanelRow } from '@/components/ui/panel-row'
import { useBoxViewer, useManageableSpaceIds } from '@/hooks/useBoxAccess'
import { ChevronRightIcon } from '@/lib/icons'
import { useBoardStore } from '@/stores/board.store'

// Where a coworker made from the Simple view lands, when the workspace has several Boxes the caller
// manages. The list has no grid to drop it on: the server finds it a free spot in the Box picked.
export function BoxPickerDialog() {
    const t = useTranslations('dialogs.boxPicker')
    const tAgent = useTranslations('agent')
    const request = useBoardStore(s => s.boxChoice)
    const spaces = useBoardStore(s => s.spaces)
    const agents = useBoardStore(s => s.agents)
    const manageable = useManageableSpaceIds()
    const viewer = useBoxViewer()
    const boxes = useMemo(() => spaces.filter(space => manageable.has(space.id)).map(space => ({ space, coworkers: agents.filter(agent => agent.spaceId === space.id).length })), [spaces, manageable, agents])
    const choose = (spaceId: string | null) => useBoardStore.getState().chooseBox(spaceId, viewer)

    return (
        <Dialog open={request !== null} onOpenChange={open => !open && choose(null)}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('title')}</DialogTitle>
                    <DialogDescription>{t('description')}</DialogDescription>
                </DialogHeader>
                <div className="-mx-1 flex max-h-[min(24rem,60dvh)] flex-col gap-1.5 overflow-y-auto px-1">
                    {boxes.map(({ space, coworkers }) => (
                        <PanelRow
                            key={space.id}
                            title={space.name?.trim() || tAgent('untitledBox')}
                            description={t('coworkers', { count: coworkers })}
                            onClick={() => choose(space.id)}
                            actions={<ChevronRightIcon className="size-4 text-muted-foreground" />}
                        />
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}
