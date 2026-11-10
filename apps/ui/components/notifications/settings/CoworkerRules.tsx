'use client'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { CalendarClock, Plus, XIcon } from '@/lib/icons'
import { COWORKER_MODES, DEFAULT_COWORKER_RULE, hasOwnRule, resetRule, type CoworkerMode, type CoworkerRule } from '@/lib/notifications/prefs'
import { cn } from '@/lib/utils'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { SETTINGS_CARD, SettingsSection } from './SettingsSection'

export type CoworkerOption = { id: string; name: string }

export type CoworkerPickerProps = { exclude: string[]; onPick: (agentId: string) => void }

export function CoworkerAvatar({ id, size = 20, className }: { id: string; size?: number; className?: string }) {
    return (
        <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted/60', className)} style={{ width: size + 8, height: size + 8 }}>
            <AgentBuddy agentId={id} size={size} animated={false} facing="right" />
        </span>
    )
}

type CoworkerRulesProps = {
    coworkers: CoworkerOption[]
    rules: Record<string, CoworkerRule>
    onChange: (agentId: string, rule: CoworkerRule) => void
    /** Listed even while it has no rule of its own, and scrolled into view. */
    pinnedId?: string | null
    renderPicker: (props: CoworkerPickerProps) => ReactNode
}

export function CoworkerRules({ coworkers, rules, onChange, pinnedId, renderPicker }: CoworkerRulesProps) {
    const t = useTranslations('notifications.settings')
    const [adding, setAdding] = useState(false)
    const pinnedRow = useRef<HTMLDivElement>(null)
    const ruleOf = (id: string) => rules[id] ?? DEFAULT_COWORKER_RULE
    const listed = coworkers.filter(c => c.id === pinnedId || hasOwnRule(ruleOf(c.id)))
    const exclude = listed.map(c => c.id)
    const nothingToAdd = listed.length === coworkers.length

    useEffect(() => {
        if (pinnedId) pinnedRow.current?.scrollIntoView({ block: 'center' })
    }, [pinnedId])

    return (
        <SettingsSection
            title={t('perCoworker.title')}
            detail={t('perCoworker.detail')}
            action={
                <TooltipDisabledReason reason={nothingToAdd ? t('perCoworker.allListed') : undefined}>
                    <Button type="button" variant="ghost" size="sm" disabled={nothingToAdd} aria-expanded={adding} onClick={() => setAdding(a => !a)}>
                        <Plus />
                        {t('perCoworker.add')}
                    </Button>
                </TooltipDisabledReason>
            }
        >
            {adding && !nothingToAdd && (
                <div className="px-1">
                    {renderPicker({
                        exclude,
                        onPick: agentId => {
                            onChange(agentId, { ...ruleOf(agentId), mode: 'everything' })
                            setAdding(false)
                        },
                    })}
                </div>
            )}
            <div className={SETTINGS_CARD}>
                {listed.length === 0 && <p className="px-3 py-3 text-xs text-muted-foreground">{t('perCoworker.empty')}</p>}
                {listed.map(c => {
                    const rule = ruleOf(c.id)
                    return (
                        <div key={c.id} ref={c.id === pinnedId ? pinnedRow : undefined} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
                            <CoworkerAvatar id={c.id} />
                            <span className="flex min-w-32 flex-1 flex-col">
                                <span className="truncate text-sm">{c.name}</span>
                                {rule.follow && (
                                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                        <CalendarClock className="size-3 shrink-0" />
                                        {t('perCoworker.following')}
                                    </span>
                                )}
                            </span>
                            <div className="ml-auto flex items-center gap-1">
                                <Select value={rule.mode} onValueChange={mode => onChange(c.id, { ...rule, mode: mode as CoworkerMode })}>
                                    <SelectTrigger size="sm" className="w-32" aria-label={t('notificationsFor', { name: c.name })}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {COWORKER_MODES.map(mode => (
                                            <SelectItem key={mode} value={mode}>
                                                {t(`modes.${mode}.label`)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <TooltipDisabledReason reason={hasOwnRule(rule) ? undefined : t('perCoworker.alreadyDefault', { name: c.name })}>
                                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t('perCoworker.reset', { name: c.name })} disabled={!hasOwnRule(rule)} onClick={() => onChange(c.id, resetRule(rule))} className="text-muted-foreground">
                                        <XIcon />
                                    </Button>
                                </TooltipDisabledReason>
                            </div>
                        </div>
                    )
                })}
            </div>
        </SettingsSection>
    )
}
