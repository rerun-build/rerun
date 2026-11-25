'use client'

import { Orb } from '@/components/foreman/Orb'
import { Button } from '@/components/ui/button'
import { ArrowUpIcon, BoxIcon, ChevronDownIcon, ChevronsUpDownIcon, MessageCircle, PaperclipIcon, PlusIcon, SearchIcon, SettingsIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { SIMPLE_LIST_WIDTH } from '@/lib/workspace-view'
import { CardAvatar, Message, MessageContent } from '@rerun/ui/chat'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import { ATLAS, IRIS, NOVA, PICO, type CastMember } from './cast'

type Status = 'idle' | 'working' | 'waiting'
type Row = { member: CastMember; line: 'nova' | 'atlas' | 'iris' | 'pico'; status: Status }

const BOXES: { name: 'growth' | 'backOffice'; crew: Row[] }[] = [
    {
        name: 'growth',
        crew: [
            { member: NOVA, line: 'nova', status: 'idle' },
            { member: ATLAS, line: 'atlas', status: 'working' },
        ],
    },
    {
        name: 'backOffice',
        crew: [
            { member: IRIS, line: 'iris', status: 'idle' },
            { member: PICO, line: 'pico', status: 'waiting' },
        ],
    },
]

const MESSAGES = ['first', 'second', 'third', 'fourth', 'fifth'] as const

// The classic view of the app on a made-up workspace, with its own components and its own classes.
// What needs a session there (the workspace switcher, the menus of a row) keeps the markup of the real
// one with a fixed answer in its place.
export function ClassicApp({ person }: { person: string }) {
    return (
        <div className="flex size-full overflow-hidden bg-background">
            <div className="flex shrink-0 flex-col border-e border-border" style={{ width: SIMPLE_LIST_WIDTH.defaultWidth }}>
                <Sidebar person={person} />
            </div>
            <ChatPane />
        </div>
    )
}

function Sidebar({ person }: { person: string }) {
    const t = useTranslations('workspaceView')
    const tApp = useTranslations('onboarding.view.panel.app')
    return (
        <>
            <div className="flex h-12 shrink-0 items-center border-b border-border px-2">
                <span className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-sm">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-brand text-[10px] font-semibold text-white">{tApp('workspace').charAt(0)}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{tApp('workspace')}</span>
                    <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
                </span>
            </div>
            <div className="px-3 pt-2 pb-2">
                <span className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm text-muted-foreground">
                    <SearchIcon className="size-4 shrink-0" />
                    <span className="truncate">{t('list.search')}</span>
                </span>
            </div>
            <div className="flex items-center gap-1 pt-2 pe-3 pb-1 ps-5">
                <span className="text-xs font-medium text-muted-foreground">{t('list.label')}</span>
                <span className="flex-1" />
                <Button variant="ghost" size="icon-sm">
                    <BoxIcon className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm">
                    <PlusIcon className="size-4" />
                </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-hidden px-2 pb-2">
                <div className="flex items-center gap-3 rounded-lg py-2.5 pe-2 ps-2">
                    <span className="flex size-9 shrink-0 items-center justify-center">
                        <Orb size={30} state="idle" facing="right" />
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] leading-5 font-medium">{t('foreman.name', { named: 'no', name: '' })}</span>
                        <span className="block truncate text-[13px] leading-[18px] text-muted-foreground">{tApp('foreman')}</span>
                    </span>
                </div>
                {BOXES.map(box => (
                    <div key={box.name}>
                        <div className="flex h-9 items-center gap-1.5 ps-2 text-xs font-medium text-muted-foreground">
                            <ChevronDownIcon className="size-3 shrink-0" />
                            <span className="truncate">{tApp(box.name)}</span>
                            <span className="tabular-nums">{box.crew.length}</span>
                        </div>
                        <div className="space-y-1">
                            {box.crew.map(row => (
                                <CoworkerRow key={row.member.id} row={row} selected={row.member.id === NOVA.id} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-2 border-t border-border px-3 py-2 text-sm">
                <CardAvatar name={person} className="size-6 text-[10px]" />
                <span className="min-w-0 flex-1 truncate">{person}</span>
                <SettingsIcon className="size-4 shrink-0 text-muted-foreground" />
            </div>
        </>
    )
}

function CoworkerRow({ row: { member, line, status }, selected }: { row: Row; selected: boolean }) {
    const t = useTranslations('onboarding.view.panel.app')
    return (
        <div className={cn('flex items-center gap-3 rounded-lg py-2.5 pe-2 ps-2', selected && 'bg-accent text-accent-foreground')}>
            <AgentBuddy agentId={member.id} look={member.look} size={36} facing="right" className="shrink-0" />
            <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] leading-5 font-medium">{member.name}</span>
                    {selected && <span className="shrink-0 text-[11px] text-muted-foreground">{t('now')}</span>}
                </span>
                <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] text-muted-foreground">{t(`lines.${line}`)}</span>
                    <StatusDot status={status} />
                </span>
            </span>
        </div>
    )
}

function StatusDot({ status }: { status: Status }) {
    if (status === 'idle') return null
    return (
        <span className="relative flex size-2 shrink-0">
            {status === 'working' && <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/70 motion-reduce:animate-none" />}
            <span className={cn('relative size-2 rounded-full', status === 'working' ? 'bg-emerald-500' : 'bg-orange-400')} />
        </span>
    )
}

function ChatPane() {
    const t = useTranslations('onboarding.view.panel.app')
    const tShowcase = useTranslations('onboarding.showcase')
    return (
        <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border px-2 text-xs">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent">
                    <AgentBuddy agentId={NOVA.id} look={NOVA.look} size={28} facing="right" />
                </span>
                <span className="flex h-7 items-center truncate rounded-md bg-accent px-2 font-medium text-accent-foreground">{t('triage')}</span>
                <span className="flex h-7 min-w-0 flex-1 items-center truncate px-2 text-muted-foreground">{t('report')}</span>
                <MessageCircle className="me-2 size-4 shrink-0 text-muted-foreground" />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden p-4">
                {MESSAGES.map((message, index) => (
                    <Message key={message} from={index % 2 === 0 ? 'assistant' : 'user'}>
                        <MessageContent>
                            <p>{t(`messages.${message}`)}</p>
                        </MessageContent>
                    </Message>
                ))}
            </div>
            <div className="shrink-0 border-t border-border p-3">
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-2.5">
                    <span className="text-sm text-muted-foreground">{tShowcase('task.placeholder', { name: NOVA.name })}</span>
                    <div className="flex items-center justify-between pt-4">
                        <PaperclipIcon className="size-4 text-muted-foreground" />
                        <Button size="icon-sm">
                            <ArrowUpIcon className="size-4" />
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}
