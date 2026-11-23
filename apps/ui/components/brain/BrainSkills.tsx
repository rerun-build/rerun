'use client'

import { createBrainSkillAction, deleteBrainSkillAction, listShareableSkillsAction, shareSkillToBrainAction, updateBrainSkillAction, type ShareableSkills } from '@/app/api/_actions/brain.actions'
import { BrainAddedBy } from '@/components/brain/BrainItemProperties'
import { PageColumn, PageProperty } from '@/components/brain/BrainPageParts'
import { BrainTopBar, type BrainCrumb } from '@/components/brain/BrainTopBar'
import { Group } from '@/components/connections/AiProvidersPanel'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { MarkdownTextarea } from '@/components/ui/markdown-textarea'
import { PanelRow } from '@/components/ui/panel-row'
import { SkeletonRows } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import { coworkerOfAuthor, type BrainFiling } from '@/lib/brain/items'
import { FileTextIcon, LayersIcon, PencilIcon, PlusIcon, Share2Icon, Trash2Icon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { shortRelativeTime } from '@rerun/i18n/format'
import type { BrainSkill } from '@rerun/contracts'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { Markdown } from '@rerun/ui/markdown'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

function useSkillsCrumb(onOpenList: () => void): BrainCrumb {
    const t = useTranslations('brain.skills')
    return { label: t('title'), icon: LayersIcon, onClick: onOpenList }
}

function PageHeading({ title, subtitle }: { title: string; subtitle: string }) {
    return (
        <>
            <h1 className="text-[2rem] font-semibold leading-tight tracking-tight break-words">{title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </>
    )
}

function AuthorBuddy({ author, filing }: { author: string | null; filing: BrainFiling }) {
    const coworker = coworkerOfAuthor(author, filing.coworkers)
    return coworker ? <AgentBuddy agentId={coworker.id} size={20} animated={false} facing="right" /> : null
}

export function BrainSkillsList({ skills, filing, onOpen, onShare, onNew }: { skills: BrainSkill[]; filing: BrainFiling; onOpen: (slug: string) => void; onShare: () => void; onNew: () => void }) {
    const t = useTranslations('brain.skills')
    const actions = (className?: string) => (
        <div className={cn('flex flex-wrap gap-2', className)}>
            <Button size="sm" variant="outline" onClick={onShare}>
                <Share2Icon className="size-3.5" /> {t('share')}
            </Button>
            <Button size="sm" variant="outline" onClick={onNew}>
                <PlusIcon className="size-3.5" /> {t('newSkill')}
            </Button>
        </div>
    )
    return (
        <>
            <BrainTopBar crumbs={[{ label: t('title'), icon: LayersIcon }]} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <PageColumn className="max-w-[820px]">
                    <PageHeading title={t('title')} subtitle={t('subtitle')} />
                    {skills.length === 0 ? (
                        <EmptyState icon={LayersIcon} title={t('emptyTitle')} description={t('emptyDescription')} action={actions('justify-center')} className="mt-10" />
                    ) : (
                        <>
                            {actions('mt-6')}
                            <div className="mt-6 space-y-1.5">
                                {skills.map(skill => (
                                    <PanelRow
                                        key={skill.slug}
                                        onClick={() => onOpen(skill.slug)}
                                        leading={<Icon icon={LayersIcon} size="sm" />}
                                        title={skill.name}
                                        description={skill.description}
                                        meta={
                                            <>
                                                {skill.files.length > 0 && (
                                                    <Badge size="xs" tone="neutral" glow={false} leading={<FileTextIcon className="size-2.5" />}>
                                                        {skill.files.length}
                                                    </Badge>
                                                )}
                                                <AuthorBuddy author={skill.author} filing={filing} />
                                            </>
                                        }
                                    />
                                ))}
                            </div>
                        </>
                    )}
                </PageColumn>
            </div>
        </>
    )
}

type SkillPageProps = {
    skill: BrainSkill
    filing: BrainFiling
    onOpenList: () => void
    onSaved: (skill: BrainSkill) => void
    onDeleted: (slug: string) => void
}

export function BrainSkillPage({ skill, filing, onOpenList, onSaved, onDeleted }: SkillPageProps) {
    const t = useTranslations('brain.skills')
    const locale = useLocale()
    const errorText = useErrorText()
    const skillsCrumb = useSkillsCrumb(onOpenList)
    const [editing, setEditing] = useState(false)
    const [description, setDescription] = useState(skill.description)
    const [body, setBody] = useState(skill.body)
    const [saving, setSaving] = useState(false)
    const [confirmingDelete, setConfirmingDelete] = useState(false)
    const [deleting, setDeleting] = useState(false)

    const startEditing = () => {
        setDescription(skill.description)
        setBody(skill.body)
        setEditing(true)
    }

    const save = async () => {
        setSaving(true)
        const result = await updateBrainSkillAction(skill.slug, { description, body })
        setSaving(false)
        if (!result.ok) {
            toast.error(errorText(result))
            return
        }
        onSaved(result.skill)
        setEditing(false)
    }

    const remove = async () => {
        setDeleting(true)
        const result = await deleteBrainSkillAction(skill.slug)
        setDeleting(false)
        if (!result.ok) {
            toast.error(errorText(result, t('deleteFailed')))
            return
        }
        setConfirmingDelete(false)
        onDeleted(skill.slug)
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <BrainTopBar crumbs={[skillsCrumb, { label: skill.name }]}>
                {!editing && (
                    <Button size="icon-sm" variant="ghost" onClick={startEditing} aria-label={t('edit')} title={t('edit')}>
                        <PencilIcon />
                    </Button>
                )}
                <Button size="icon-sm" variant="ghost" onClick={() => setConfirmingDelete(true)} aria-label={t('delete')} title={t('delete')}>
                    <Trash2Icon />
                </Button>
            </BrainTopBar>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <PageColumn>
                    <Icon icon={LayersIcon} size="lg" className="mb-4" />
                    <h1 className="text-[2rem] font-semibold leading-tight tracking-tight break-words">{skill.name}</h1>
                    {!editing && skill.description && <p className="mt-2 text-sm text-muted-foreground">{skill.description}</p>}
                    <div className="mt-6 space-y-1 border-y py-3">
                        <PageProperty label={t('usedBy')}>
                            <Badge size="xs" tone="brand" glow={false}>
                                {t('everyCoworker')}
                            </Badge>
                        </PageProperty>
                        <PageProperty label={t('addedBy')}>
                            <BrainAddedBy author={skill.author} filing={filing} />
                            <span className="text-muted-foreground">· {shortRelativeTime(skill.addedAt, locale)}</span>
                        </PageProperty>
                        {skill.files.length > 0 && (
                            <PageProperty label={t('files')}>
                                {skill.files.map(file => (
                                    <code key={file} className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                        {file}
                                    </code>
                                ))}
                            </PageProperty>
                        )}
                    </div>
                    {editing ? (
                        <div className="mt-6 space-y-4">
                            <Input label={t('description')} hideRequired value={description} onChange={event => setDescription(event.target.value)} placeholder={t('descriptionPlaceholder')} className="h-8 text-sm" />
                            <MarkdownTextarea label={t('instructions')} dialogTitle={t('instructionsDialogTitle')} value={body} onChange={setBody} className="min-h-64 font-mono text-xs" placeholder={t('instructionsPlaceholder')} />
                            <div className="flex flex-wrap justify-end gap-2">
                                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
                                    {t('cancel')}
                                </Button>
                                <Button size="sm" loading={saving} onClick={() => void save()} disabled={!body.trim()}>
                                    {t('save')}
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <Markdown content={skill.body} className="mt-6" />
                    )}
                </PageColumn>
            </div>
            <ConfirmDialog open={confirmingDelete} onOpenChange={setConfirmingDelete} pending={deleting} title={t('deleteTitle', { name: skill.name })} description={t('deleteDescription')} onConfirm={() => void remove()} />
        </div>
    )
}

export function BrainSkillMissing({ slug, onOpenList }: { slug: string; onOpenList: () => void }) {
    const t = useTranslations('brain.skills')
    const skillsCrumb = useSkillsCrumb(onOpenList)
    return (
        <>
            <BrainTopBar crumbs={[skillsCrumb, { label: slug }]} />
            <EmptyState icon={LayersIcon} title={t('missingTitle')} description={t('missingDescription')} />
        </>
    )
}

export function BrainNewSkill({ onOpenList, onCreated }: { onOpenList: () => void; onCreated: (skill: BrainSkill) => void }) {
    const t = useTranslations('brain.skills')
    const errorText = useErrorText()
    const skillsCrumb = useSkillsCrumb(onOpenList)
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [body, setBody] = useState('')
    const [creating, setCreating] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const create = async () => {
        setCreating(true)
        setError(null)
        const result = await createBrainSkillAction({ name: name.trim(), description: description.trim(), body })
        setCreating(false)
        if (!result.ok) {
            setError(errorText(result))
            return
        }
        onCreated(result.skill)
    }

    return (
        <>
            <BrainTopBar crumbs={[skillsCrumb, { label: t('newSkill') }]} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <PageColumn>
                    <Icon icon={LayersIcon} size="lg" className="mb-4" />
                    <PageHeading title={t('newSkill')} subtitle={t('subtitle')} />
                    <div className="mt-6 space-y-4">
                        {error && <p className="text-xs text-destructive">{error}</p>}
                        <Input label={t('name')} hideRequired value={name} onChange={event => setName(event.target.value)} placeholder={t('namePlaceholder')} autoFocus className="h-8 text-sm" />
                        <Input label={t('description')} hideRequired value={description} onChange={event => setDescription(event.target.value)} placeholder={t('descriptionPlaceholder')} className="h-8 text-sm" />
                        <MarkdownTextarea label={t('instructions')} dialogTitle={t('instructionsDialogTitle')} value={body} onChange={setBody} className="min-h-64 font-mono text-xs" placeholder={t('instructionsPlaceholder')} />
                        <div className="flex justify-end">
                            <Button size="sm" loading={creating} onClick={() => void create()} disabled={!name.trim() || !body.trim()}>
                                {t('create')}
                            </Button>
                        </div>
                    </div>
                </PageColumn>
            </div>
        </>
    )
}

export function BrainShareSkill({ skills, onOpenList, onShared }: { skills: BrainSkill[]; onOpenList: () => void; onShared: (skill: BrainSkill) => void }) {
    const t = useTranslations('brain.skills')
    const errorText = useErrorText()
    const skillsCrumb = useSkillsCrumb(onOpenList)
    const [owners, setOwners] = useState<ShareableSkills[] | null>(null)
    const [sharing, setSharing] = useState<string | null>(null)
    const [confirming, setConfirming] = useState<{ owner: ShareableSkills; slug: string; name: string } | null>(null)
    const inBrain = new Set(skills.map(skill => skill.slug))

    useEffect(() => {
        let live = true
        void listShareableSkillsAction().then(list => live && setOwners(list))
        return () => {
            live = false
        }
    }, [])

    const share = async (owner: ShareableSkills, slug: string) => {
        const key = `${owner.coworker.id}:${slug}`
        setSharing(key)
        const result = await shareSkillToBrainAction(owner.coworker.id, slug)
        setSharing(null)
        setConfirming(null)
        if (!result.ok) {
            toast.error(errorText(result))
            return
        }
        setOwners(current => (current ?? []).map(entry => (entry.coworker.id === owner.coworker.id ? { ...entry, skills: entry.skills.filter(own => own.slug !== slug) } : entry)).filter(entry => entry.skills.length > 0))
        toast.success(t('sharedToast', { name: result.skill.name }))
        onShared(result.skill)
    }

    return (
        <>
            <BrainTopBar crumbs={[skillsCrumb, { label: t('shareCrumb') }]} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <PageColumn>
                    <PageHeading title={t('share')} subtitle={t('shareSubtitle')} />
                    <div className="mt-8 space-y-6">
                        {owners === null ? (
                            <SkeletonRows rows={4} />
                        ) : owners.length === 0 ? (
                            <EmptyState icon={Share2Icon} title={t('noShareableTitle')} description={t('noShareableDescription')} />
                        ) : (
                            owners.map(owner => (
                                <Group key={owner.coworker.id} title={owner.coworker.name}>
                                    {owner.skills.map(own => (
                                        <PanelRow
                                            key={own.slug}
                                            leading={<AgentBuddy agentId={owner.coworker.id} size={28} animated={false} facing="right" />}
                                            title={own.name}
                                            description={own.description}
                                            actions={
                                                inBrain.has(own.slug) ? (
                                                    <Badge size="xs" tone="neutral" glow={false}>
                                                        {t('inBrain')}
                                                    </Badge>
                                                ) : (
                                                    <TooltipDisabledReason reason={owner.canShare ? undefined : t('shareLocked', { name: owner.coworker.name })}>
                                                        <Button size="sm" variant="outline" disabled={!owner.canShare || sharing !== null} loading={sharing === `${owner.coworker.id}:${own.slug}`} onClick={() => setConfirming({ owner, slug: own.slug, name: own.name })}>
                                                            <Share2Icon className="size-3.5" /> {t('shareAction')}
                                                        </Button>
                                                    </TooltipDisabledReason>
                                                )
                                            }
                                        />
                                    ))}
                                </Group>
                            ))
                        )}
                    </div>
                </PageColumn>
            </div>
            <ConfirmDialog
                open={confirming !== null}
                onOpenChange={open => !open && setConfirming(null)}
                pending={sharing !== null}
                title={t('shareConfirmTitle', { name: confirming?.name ?? '' })}
                description={t('shareConfirmDescription', { coworker: confirming?.owner.coworker.name ?? '' })}
                confirmLabel={t('shareConfirm')}
                confirmVariant="default"
                onConfirm={() => {
                    if (confirming) void share(confirming.owner, confirming.slug)
                }}
            />
        </>
    )
}
