import { brainChangeHeadline, type BrainChange } from '@rerun/contracts'
import { useState, type ReactNode } from 'react'
import { Alert, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { revertBrainPage } from '@/api/chat'
import { useAuth } from '@/auth/AuthProvider'

import { AppText } from '@/components/ui/AppText'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useTheme } from '@/theme/theme'
import { radius, spacing } from '@/theme/tokens'

import type { EventCard } from './cards'

// One thing the coworker did, on the muted surface of the thread's cards: its glyph (or the app's
// logo), what happened, a note, and on the right what the person can still do about it.
export function EventRow({ symbol, icon, title, note, trailing, children }: { symbol: IconName; icon?: ReactNode; title: string; note?: string; trailing?: ReactNode; children?: ReactNode }) {
    const theme = useTheme()
    return (
        <View style={{ flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderCurve: 'continuous', backgroundColor: theme.muted }}>
            <View style={{ width: 28, height: 28, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: theme.card }}>
                {icon ?? <Icon name={symbol} size={14} color={theme.foreground} />}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="callout" medium>
                    {title}
                </AppText>
                {note ? (
                    <AppText variant="footnote" tone="muted">
                        {note}
                    </AppText>
                ) : null}
                {children}
            </View>
            {trailing ? <View style={{ alignSelf: 'center' }}>{trailing}</View> : null}
        </View>
    )
}

type Undo = 'idle' | 'pending' | 'done'

// A change the Rerun agent made to the Brain itself, already landed: an edit can still be undone from
// here, as on the web. Opening the page stays on the web, which has the Brain.
function BrainChangeRow({ change }: { change: BrainChange }) {
    const t = useTranslations('mobileCards')
    const tBrain = useTranslations('mobileCards.brain')
    const { session, me } = useAuth()
    const [undo, setUndo] = useState<Undo>('idle')
    const undoRevisionId = change.status === 'saved' && change.mode === 'edit' ? change.undoRevisionId : null
    const undoChange = async () => {
        if (!undoRevisionId || !session || !me) return
        setUndo('pending')
        try {
            await revertBrainPage({ accessToken: session.access_token, workspaceId: me.workspace.id }, change.slug, undoRevisionId, change.hash)
            setUndo('done')
        } catch (error) {
            setUndo('idle')
            Alert.alert(t('event.undoFailed'), error instanceof Error ? error.message : t('event.tryAgainShortly'))
        }
    }
    if (undo === 'done') return <EventRow symbol="brain" title={t('event.undone', { title: change.title })} note={t('event.undoneNote')} />
    return <EventRow symbol="brain" title={brainChangeHeadline(change, tBrain)} note={t(`brain.notes.${change.status}`)} trailing={undoRevisionId ? <Button size="sm" variant="ghost" label={t('event.undo')} loading={undo === 'pending'} onPress={() => void undoChange()} /> : undefined} />
}

export function EventCardView({ card, coworkerName }: { card: EventCard; coworkerName: string }) {
    const t = useTranslations('mobileCards.event')
    switch (card.kind) {
        case 'notification':
            return <EventRow symbol="bell" title={t('notification')} note={card.message} />
        case 'setup':
            return (
                <EventRow symbol="badge-check" title={coworkerName ? t('setUp', { name: coworkerName }) : t('setupComplete')} note={card.summary || undefined}>
                    {(card.schedules > 0 || card.triggers > 0) && (
                        <View style={{ flexDirection: 'row', gap: spacing.xs, marginTop: spacing.xs }}>
                            {card.schedules > 0 && <Badge size="xs" label={t('schedules', { count: card.schedules })} tone="green" />}
                            {card.triggers > 0 && <Badge size="xs" label={t('triggers', { count: card.triggers })} tone="green" />}
                        </View>
                    )}
                </EventRow>
            )
        case 'brain-proposal':
            return <EventRow symbol="brain" title={card.mode === 'create' ? t('newBrainPage', { title: card.title }) : t('brainChange', { title: card.title })} note={t('proposedNote')} />
        case 'brain-change':
            return <BrainChangeRow change={card.change} />
    }
}
