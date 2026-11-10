'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { CreateTemplateDialog } from '@/components/dialogs/CreateTemplateDialog'
import { CaptureAgentsDialog } from '@/components/templates/capture/CaptureAgentsDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { LayersIcon } from '@/lib/icons'
import { useCreatorStore } from '@/stores/creator.store'
import { CreatorPayoutsPanel, CreatorRevenuePanel, CreatorSidebarFooter, useCreatorPayouts } from '@rerun/cloud/marketplace.client'
import { expertCaptureActions } from './expertCaptureActions'
import { ExpertTemplateList } from './ExpertTemplateList'
import { MyTemplateEditor } from './MyTemplateEditor'
import { MyTemplateEditorSkeleton } from './MyTemplateEditorSkeleton'
import { useMyTemplates } from './useMyTemplates'

// The expert authoring surface, opened from the builder toolbar of a sandbox. Master-detail: the
// list of their templates on the left, the selected pane on the right. Templates are addressed by
// id, because the panel has no route to push and a slug can move under an admin edit.
//
// The pane is a union rather than an id plus flags: payouts and revenue are siblings of a template,
// not modes layered on top of one. It lives in the creator store because the return from Stripe's
// hosted onboarding lands on the home page and has to reopen this panel on the right pane.
//
// The create dialog is a sibling rather than a child: the toolbar's "+" menu creates a template
// without ever opening the panel.
export function MyTemplatesDialog() {
    const t = useTranslations('templates.expert.dialog')
    const open = useCreatorStore(state => state.open)
    const setOpen = useCreatorStore(state => state.setOpen)
    const pane = useCreatorStore(state => state.pane)
    const setPane = useCreatorStore(state => state.setPane)
    const createOpen = useCreatorStore(state => state.createOpen)
    const setCreateOpen = useCreatorStore(state => state.setCreateOpen)

    const [capturing, setCapturing] = useState(false)
    const editingId = pane.kind === 'template' ? pane.id : null
    const { templates, detail, create, save, submit, withdraw, remove, removeAgent, reload } = useMyTemplates(open, editingId)
    // Loaded with the panel rather than with the payouts pane: the footer badge and the pricing
    // warning both need it before anyone clicks through.
    const { account } = useCreatorPayouts(open)

    const handleOpenChange = (next: boolean) => {
        setOpen(next)
        if (!next) setCapturing(false)
    }

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent className="gap-0 overflow-hidden p-0 max-sm:h-[85dvh] sm:max-w-5xl">
                    {/* Explicit row: an implicit `auto` row is sized by its tallest pane and grows past the
                        dialog, which leaves the panes clipped instead of scrolling. */}
                    <div className="grid min-h-0 flex-1 grid-cols-1 sm:h-[min(46rem,88dvh)] sm:grid-cols-[19rem_1fr] sm:grid-rows-[minmax(0,1fr)]">
                        <div className="flex min-h-0 flex-col border-r border-border">
                            <DialogHeader className="p-5 pb-4">
                                <DialogTitle>{t('title')}</DialogTitle>
                                <DialogDescription className="text-xs">{t('description')}</DialogDescription>
                            </DialogHeader>
                            <ExpertTemplateList
                                templates={templates}
                                selectedId={editingId}
                                onRequestCreate={() => setCreateOpen(true)}
                                onSelect={id => setPane({ kind: 'template', id })}
                            />
                            <CreatorSidebarFooter pane={pane} account={account} onSelect={setPane} />
                        </div>

                        <div className="flex min-h-0 flex-col">
                            {pane.kind === 'payouts' ? (
                                <CreatorPayoutsPanel active={open} />
                            ) : pane.kind === 'revenue' ? (
                                <CreatorRevenuePanel active={open} />
                            ) : pane.kind === 'empty' ? (
                                <EmptyState icon={LayersIcon} title={t('pickTitle')} description={t('pickDescription')} />
                            ) : detail === null ? (
                                <MyTemplateEditorSkeleton />
                            ) : (
                                <MyTemplateEditor
                                    key={detail.id}
                                    template={detail}
                                    payoutsReady={account?.state === 'ready'}
                                    onSave={values => save(detail.id, values)}
                                    onSubmit={() => submit(detail.id)}
                                    onWithdraw={() => withdraw(detail.id)}
                                    onDelete={async () => {
                                        const removed = await remove(detail.id)
                                        if (removed) setPane({ kind: 'empty' })
                                        return removed
                                    }}
                                    onCapture={() => setCapturing(true)}
                                    onRemoveAgent={key => removeAgent(detail.id, key)}
                                />
                            )}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <CreateTemplateDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                onCreate={create}
                captureActions={expertCaptureActions}
                onDone={id => {
                    setPane({ kind: 'template', id })
                    setOpen(true)
                    // The dialog may have captured agents into the draft after it was listed.
                    void reload()
                }}
            />

            {/* Driven by `open` rather than mounted on demand, so Radix runs its close sequence and
                hands focus back to the panel underneath. */}
            {editingId && <CaptureAgentsDialog open={capturing} onOpenChange={setCapturing} actions={expertCaptureActions(editingId)} onCaptured={reload} />}
        </>
    )
}
