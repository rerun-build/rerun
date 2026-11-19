import { FOREMAN_AGENT_ID } from '@moldwright/contracts'
import { View } from 'react-native'
import { useTranslations } from 'use-intl'

import { AgentBuddy } from '@/components/buddy/AgentBuddy'
import { moodStatus, type HomeCoworker } from '@/components/home/board'
import { usePaneSize } from '@/components/layout/PaneSize'
import { columnsFor } from '@/components/layout/split'
import { HOME_GUTTER } from '@/components/home/CoworkerRow'
import { AppText } from '@/components/ui/AppText'
import { CoworkerAvatar, moodOf } from '@/components/ui/CoworkerAvatar'
import { LongPressMenu, MenuItem } from '@/components/ui/NativeMenu'
import { UnreadDot } from '@/components/ui/UnreadDot'
import { useTheme } from '@/theme/theme'
import { spacing } from '@/theme/tokens'

const FEWEST_COLUMNS = 3
const MIN_CELL = 108
const DISC_MAX = 88
const UNREAD_DOT = 14

export type PinnedCell = { width: number; disc: number; columns: number }

export function usePinnedCell(): PinnedCell {
    const { width } = usePaneSize()
    const inner = width - 2 * HOME_GUTTER
    const columns = columnsFor(inner, MIN_CELL, FEWEST_COLUMNS)
    const cellWidth = Math.floor(inner / columns)
    return { width: cellWidth, disc: Math.min(DISC_MAX, cellWidth - 2 * spacing.md), columns }
}

export function PinnedAvatar({ coworker, cell, animated = true }: { coworker: HomeCoworker; cell: PinnedCell; animated?: boolean }) {
    const theme = useTheme()
    const unread = coworker.pending > 0
    const dotInset = Math.round((cell.disc / 2) * (1 - Math.SQRT1_2) - UNREAD_DOT / 2)
    return (
        <View style={{ width: cell.width, alignItems: 'center', gap: spacing.xs + 2, paddingVertical: spacing.sm }}>
            <View style={{ width: cell.disc, height: cell.disc, borderRadius: cell.disc / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
                {coworker.id === FOREMAN_AGENT_ID ? <CoworkerAvatar coworker={{ id: coworker.id, kind: 'foreman', status: coworker.status === 'working' ? 'working' : 'idle' }} size={Math.round(cell.disc * 0.7)} animated={animated} /> : <AgentBuddy agentId={coworker.id} size={Math.round(cell.disc * 0.7)} mood={moodOf(moodStatus(coworker))} animated={animated} />}
                {unread && <UnreadDot style={{ position: 'absolute', top: dotInset, left: dotInset, width: UNREAD_DOT, height: UNREAD_DOT, borderRadius: UNREAD_DOT / 2, borderWidth: 2, borderColor: theme.background }} />}
            </View>
            <AppText variant="footnote" tone={unread ? 'default' : 'muted'} medium={unread} numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ maxWidth: cell.width - spacing.sm, textAlign: 'center' }}>
                {coworker.name}
            </AppText>
        </View>
    )
}

type PinnedGridProps = {
    coworkers: HomeCoworker[]
    onOpen: (coworker: HomeCoworker) => void
    onUnpin: (coworker: HomeCoworker) => void
    onDetails: (coworker: HomeCoworker) => void
    onEdit?: () => void
}

export function PinnedGrid({ coworkers, onOpen, onUnpin, onDetails, onEdit }: PinnedGridProps) {
    const cell = usePinnedCell()
    const t = useTranslations('mobileHome')
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: HOME_GUTTER }}>
            {coworkers.map(coworker => (
                <LongPressMenu
                    key={coworker.id}
                    onPress={() => onOpen(coworker)}
                    label={coworker.pending > 0 ? t('pinned.unreadLabel', { name: coworker.name }) : coworker.name}
                    items={
                        <>
                            <MenuItem label={t('pinned.unpin')} icon="pin-off" onPress={() => onUnpin(coworker)} />
                            {coworker.id === FOREMAN_AGENT_ID ? null : <MenuItem label={t('pinned.details')} icon="info" onPress={() => onDetails(coworker)} />}
                            {onEdit ? <MenuItem label={t('pinned.edit')} icon="arrow-up-down" onPress={onEdit} /> : null}
                        </>
                    }
                >
                    <PinnedAvatar coworker={coworker} cell={cell} />
                </LongPressMenu>
            ))}
        </View>
    )
}
