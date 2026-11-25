'use client'

import { formatCredits, MICROS_PER_CREDIT, type Brand } from '@rerun/contracts'
import { QuestionForm, ToolCallRow } from '@rerun/ui/chat'
import { Orb } from '@rerun/ui/foreman'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { Badge, ScrollFade } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'

import { PromptInput, PromptInputButton, PromptInputFooter, PromptInputSubmit, PromptInputTextarea } from '@/components/ai-elements/prompt-input'
import { MessageView } from '@/components/chat/MessageView'
import { Progress } from '@/components/ui/progress'
import { CoworkerTile, type CoworkerTileActions } from '@/components/workspace-view/CoworkerTile'
import type { IsoAgent } from '@/lib/board/types'
import { ChevronDownIcon, InboxIcon, PaperclipIcon, SearchIcon } from '@/lib/icons'
import type { CoworkerPreview } from '@/stores/coworker-previews.store'

import { SquareLogo } from '../SquareLogo'

const noop = () => {}
const MINUTE_MS = 60_000
const CREDIT_LEFT = 1240
const ACTIONS: CoworkerTileActions = { onNewConversation: noop, onAllConversations: noop, onOpenCard: noop }

const agentOf = (id: string, name: string, status: IsoAgent['status'] = 'idle'): IsoAgent => ({ id, name, handle: null, description: null, templateId: null, status, position: { col: 0, row: 0 }, workspaceId: 1, spaceId: 'preview', disabledAt: null, disabledReason: null })
const previewOf = (minutes: number, text: string): CoworkerPreview => ({ sessionId: text, title: text, status: 'idle', updatedAt: new Date(Date.now() - minutes * MINUTE_MS).toISOString(), lastMessage: { text, from: 'agent', authorId: null } })

const TEAM = [
    { id: 'lab-nova', name: 'Nova', line: 'nova', minutes: 3, status: 'idle', unseen: true },
    { id: 'lab-ledger', name: 'Ledger', line: 'ledger', minutes: 1, status: 'working', unseen: false },
    { id: 'lab-pulse', name: 'Pulse', line: 'pulse', minutes: 12, status: 'waiting_human', unseen: false },
    { id: 'lab-echo', name: 'Echo', line: 'echo', minutes: 60, status: 'error', unseen: false },
    { id: 'lab-vega', name: 'Vega', line: 'vega', minutes: 120, status: 'idle', unseen: true },
] as const

// The app's own pieces, in a conversation that shows every place the brand's color is worn.
export function AppPreview({ brand }: { brand: Brand }) {
    const t = useTranslations('organization.preview')
    return (
        <main className="flex h-dvh overflow-hidden bg-background text-foreground">
            <Sidebar brand={brand} />
            <section className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
                    <AgentBuddy agentId="lab-nova" mood="idle" size={28} facing="right" />
                    <span className="truncate text-sm font-medium">Nova</span>
                    <Badge size="xs" tone="brand" className="ms-auto">
                        {t('admin')}
                    </Badge>
                </header>
                <ScrollFade className="min-h-0 flex-1">
                    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
                        <MessageView message={{ id: 'ask', role: 'user', parts: [{ type: 'text', text: t('ask') }] }} agentId="lab-nova" />
                        <ToolCallRow label={t('tool')} status="running" summary={t('toolSummary')} />
                        <MessageView message={{ id: 'answer', role: 'assistant', parts: [{ type: 'text', text: t('answer') }] }} agentId="lab-nova" />
                        <QuestionForm inline questions={[{ question: t('question'), options: [{ label: t('optionSmall') }, { label: t('optionHiring') }], multiple: false }]} onSubmit={noop} />
                    </div>
                </ScrollFade>
                <div className="shrink-0 p-3">
                    <div className="mx-auto max-w-2xl">
                        <PromptInput onSubmit={noop}>
                            <PromptInputTextarea placeholder={t('composer')} />
                            <PromptInputFooter>
                                <p className="px-1 text-xs text-muted-foreground">{t('tier')}</p>
                                <div className="flex items-center gap-1">
                                    <PromptInputButton tooltip={t('attach')} aria-label={t('attach')}>
                                        <PaperclipIcon className="size-4" />
                                    </PromptInputButton>
                                    <PromptInputSubmit status="ready" />
                                </div>
                            </PromptInputFooter>
                        </PromptInput>
                    </div>
                </div>
            </section>
        </main>
    )
}

function Sidebar({ brand }: { brand: Brand }) {
    const t = useTranslations('organization.preview')
    const locale = useLocale()
    return (
        <aside className="flex h-full w-72 shrink-0 flex-col border-e border-border bg-sidebar">
            <div className="flex h-12 shrink-0 items-center border-b border-border px-2">
                <span className="flex h-8 max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-sm font-medium">
                    <SquareLogo name={brand.name} iconUrl={brand.iconUrl} className="size-6 rounded-md" />
                    <span className="truncate">{brand.name}</span>
                    <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                </span>
            </div>
            <div className="space-y-0.5 px-3 pt-2 pb-2 text-sm text-muted-foreground">
                <p className="flex h-8 items-center gap-2 px-2">
                    <SearchIcon className="size-4" />
                    {t('search')}
                </p>
                <p className="flex h-8 items-center gap-2 px-2">
                    <InboxIcon className="size-4" />
                    {t('inbox')}
                    <Badge size="xs" tone="brand" glow={false} className="ms-auto tabular-nums">
                        3
                    </Badge>
                </p>
            </div>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-hidden px-2">
                <li>
                    <CoworkerTile agent={agentOf('preview-chief', t('chief'))} preview={previewOf(2, t('lines.chief'))} viewerId="me" selected={false} unseen={false} onOpen={noop} actions={ACTIONS} avatar={size => <Orb size={size * 0.75} facing="right" />} />
                </li>
                {TEAM.map(({ id, name, line, minutes, status, unseen }, index) => (
                    <li key={id}>
                        <CoworkerTile agent={agentOf(id, name, status)} preview={previewOf(minutes, t(`lines.${line}`))} viewerId="me" selected={index === 0} unseen={unseen} onOpen={noop} actions={ACTIONS} />
                    </li>
                ))}
            </ul>
            <div className="space-y-1.5 border-t border-border p-4 text-xs">
                <p className="flex justify-between">
                    <span className="text-muted-foreground">{t('credits')}</span>
                    <span className="tabular-nums">{t('creditsLeft', { amount: formatCredits(CREDIT_LEFT * MICROS_PER_CREDIT, locale) })}</span>
                </p>
                <Progress value={58} size="md" />
            </div>
        </aside>
    )
}
