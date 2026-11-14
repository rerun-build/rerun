import { SPACE_COLOR, agentTileStyle, disabledAgentTileStyle } from '@rerun/ui/iso-grid'
import { englishKitTranslator, type KitTranslator } from '@rerun/ui/locale'
import type { Container, Tile, TileCountdown, TileLink, TileResults, TileStyle } from '@rerun/ui/iso-grid'
import type { WorkspaceAccess } from '@/hooks/useWorkspaceAccess'
import { type AgentLink, type IsoAgent, type SessionEntry, type SpacePublic } from './types'
import { isPlaced } from './iso'

function pausedAgentTileStyle(name: string, access: Exclude<WorkspaceAccess, 'live'>): TileStyle {
    const locked = disabledAgentTileStyle(name)
    if (access === 'paused') return { ...locked, status: { label: 'Paused', labelKey: 'paused', tone: 'neutral' } }
    return { ...locked, badge: null, opacity: 0.55, status: { label: 'Restoring', labelKey: 'restoring', tone: 'neutral', pinned: { label: 'Restoring', labelKey: 'restoring', spinner: true } } }
}

export function tileFromAgent(a: IsoAgent, justPlaced = false, attentionCount = 0, access: WorkspaceAccess = 'live', nextRun: TileCountdown | null = null, results: TileResults | null = null, t: KitTranslator = englishKitTranslator): Tile {
    const disabled = !!a.disabledAt || access !== 'live'
    const style = access !== 'live' ? pausedAgentTileStyle(a.name, access) : disabled ? disabledAgentTileStyle(a.name) : agentTileStyle(a.status, a.name, attentionCount)
    const countdown = !disabled && a.status !== 'offline' ? nextRun : null
    const shownResults = !disabled && a.status !== 'working' && results && results.count > 0 ? results : null
    const state = t(`isoGrid.status.${access === 'paused' ? 'paused' : access === 'restoring' ? 'restoring' : disabled ? 'disabled' : a.status}`)
    return {
        id: a.id,
        position: a.position,
        span: 2,
        containerId: a.spaceId,
        style: countdown || shownResults ? { ...style, ...(countdown && { countdown }), ...(shownResults && { results: shownResults }) } : style,
        selectable: true,
        draggable: isPlaced(a.position),
        justPlaced,
        ariaLabel: t('isoGrid.tileAria', { name: a.name, state, toHandle: disabled ? 0 : attentionCount, results: shownResults?.count ?? 0 }),
    }
}

export function containerFromSpace(s: SpacePublic, t: KitTranslator = englishKitTranslator): Container {
    const label = s.name || t('isoGrid.untitledBox')
    return {
        id: s.id,
        label,
        color: SPACE_COLOR,
        col_start: s.col_start,
        row_start: s.row_start,
        col_end: s.col_end,
        row_end: s.row_end,
        ariaLabel: t('isoGrid.boxAria', { name: label }),
    }
}

export function linksFromSessions(sessions: SessionEntry[], live: AgentLink[]): TileLink[] {
    const out: TileLink[] = []
    for (const l of live) out.push({ source: l.source, target: l.target })
    for (const s of sessions) if (s.status === 'working' && s.originAgentId) out.push({ source: s.originAgentId, target: s.agentId })
    return out
}
