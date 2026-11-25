'use client'

import { CardAvatar } from '@rerun/ui/chat'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { Badge } from '@rerun/ui/primitives'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { CAST } from './cast'
import { ForemanAccent } from './ForemanAccent'
import { PanelPage } from './PanelPage'
import { PanelStage, PanelWindow } from './PanelStage'

// What the window holds without being cut: the last invited stay in sight, a longer list is counted.
const MAX_INVITES = 4
const ROW = 52

// The workspace's members as the settings list them, the person signing up and whoever they just
// invited, over the coworkers all of them share.
export function MembersPanel({ name, email, invites }: { name: string; email: string | null; invites: string[] }) {
    const t = useTranslations('onboarding.team.panel')
    const tMembers = useTranslations('dialogs.members')
    const shown = invites.slice(-MAX_INVITES)
    const more = invites.length - shown.length

    return (
        <PanelPage title={t('title')} line={t('line')}>
            <PanelStage width={480} height={64 + 16 + (MAX_INVITES + 1) * ROW + 58} accent={<ForemanAccent facing="left" className="right-8" />}>
                <PanelWindow className="h-auto">
                    <div className="border-b border-border px-4 py-3">
                        <p className="text-sm font-medium">{tMembers('title')}</p>
                        <p className="text-xs text-muted-foreground">{tMembers('description')}</p>
                    </div>
                    <ul className="space-y-1 p-2">
                        <li className="flex items-center gap-3 rounded-lg p-2">
                            <CardAvatar name={name} className="size-8 text-[11px]" />
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{name}</span>
                                {email && email !== name && <span className="block truncate text-xs text-muted-foreground">{email}</span>}
                            </span>
                            <Badge size="xs" tone="neutral">
                                {tMembers('adminBadge')}
                            </Badge>
                        </li>
                        <AnimatePresence initial={false}>
                            {shown.map(invite => (
                                <motion.li key={invite} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-3 rounded-lg p-2">
                                    <CardAvatar name={invite} className="size-8 text-[11px]" />
                                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{invite}</span>
                                    {/* The yellow of a light page is too dark on this window, dark in both themes. */}
                                    <Badge size="xs" tone="yellow" className="[--badge-fg:var(--color-yellow-400)]!">
                                        {tMembers('invite.pending')}
                                    </Badge>
                                </motion.li>
                            ))}
                        </AnimatePresence>
                    </ul>
                    <div className="flex items-center gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
                        <span className="flex -space-x-2 rtl:space-x-reverse">
                            {CAST.map(member => (
                                <AgentBuddy key={member.id} agentId={member.id} look={member.look} size={30} facing="right" />
                            ))}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{t('shared')}</span>
                        {more > 0 && <span className="shrink-0 tabular-nums">{t('more', { count: more })}</span>}
                    </div>
                </PanelWindow>
            </PanelStage>
        </PanelPage>
    )
}
