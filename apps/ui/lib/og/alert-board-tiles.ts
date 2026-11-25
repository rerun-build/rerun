import { agentTileStyle, connectorTileStyle, disabledAgentTileStyle, frameTemplateBoard, type Tile, type TileLink, type TileStyle } from '@rerun/ui/iso-grid'

import { ALERT_BOARD_SIZE, type AlertBoard, type AlertCause, type AlertCoworker, type AlertState } from './alert-board'

const MAX_ZOOM = 2.4
const COWORKER_INSET = 0.62
const CAUSE_INSET = 0.9

const FOCUS_ID = 'coworker'
const APP_ID = 'app'
const CAUSE_ID = 'cause'

const FOCUS_AT = { col: 7, row: 7 }
const APP_AT = { col: 10, row: 6 }
const NEIGHBOURS_AT = [
    { col: 3, row: 11 },
    { col: 3, row: 3 },
    { col: 11, row: 11 },
]

const CAUSE_AT = { col: 7, row: 7 }
const CREW_AT = [
    { col: 4, row: 9 },
    { col: 4, row: 4 },
    { col: 9, row: 4 },
    { col: 9, row: 9 },
]

const DEAD_CABLE = '#ef4444'

// What the cause or the app of a scene is drawn with. A scene with neither has no tile for it.
export type AlertBoardIcons = { app?: string | null; cause?: string }

export type StagedAlertBoard = { tiles: Tile[]; links: TileLink[]; pan: { x: number; y: number }; zoom: number }

const wearing = (style: TileStyle, { look }: AlertCoworker): TileStyle => ({
    ...style,
    // The name stays alone under the hand or the lock: what is wrong is what the email says.
    status: style.status && { ...style.status, pinned: undefined },
    buddy: { ...(style.buddy === true ? {} : style.buddy), ...look },
})

// An approval keeps the colour its coworker wears, under the raised hand: cyan is the question's.
function focusStyle(state: AlertState, coworker: AlertCoworker): TileStyle {
    if (state === 'approval') return wearing({ ...agentTileStyle('idle', coworker.name), badge: 'hand', buddy: { mood: 'idle' } }, coworker)
    return wearing(agentTileStyle(state === 'failed' ? 'error' : 'waiting_human', coworker.name), coworker)
}

function stoppedStyle(cause: AlertCause, coworker: AlertCoworker): TileStyle {
    if (cause === 'payment') return wearing(disabledAgentTileStyle(coworker.name), coworker)
    return wearing(agentTileStyle(cause === 'credits' ? 'offline' : 'error', coworker.name), coworker)
}

const isAccount = (cause: AlertCause) => cause !== 'credits' && cause !== 'payment'

export function stageAlertBoard(board: AlertBoard, icons: AlertBoardIcons): StagedAlertBoard {
    if (board.kind === 'cause') {
        const crew = board.coworkers.map((coworker, index): Tile => ({ id: `${FOCUS_ID}-${index}`, position: CREW_AT[index], span: 2, style: stoppedStyle(board.cause, coworker) }))
        const tiles: Tile[] = [...crew, { id: CAUSE_ID, position: CAUSE_AT, span: 1, style: connectorTileStyle(icons.cause) }]
        const links = crew.map((tile): TileLink => ({ source: tile.id, target: CAUSE_ID, variant: 'cable', ...(isAccount(board.cause) && { color: DEAD_CABLE }) }))
        return { tiles, links, ...frameTemplateBoard(tiles, ALERT_BOARD_SIZE, MAX_ZOOM, CAUSE_INSET) }
    }

    const focus: Tile = { id: FOCUS_ID, position: FOCUS_AT, span: 2, style: focusStyle(board.state, board.coworker) }
    const neighbours = board.neighbours.map((coworker, index): Tile => ({ id: `neighbour-${index}`, position: NEIGHBOURS_AT[index], span: 2, dimmed: true, style: wearing(agentTileStyle('idle', coworker.name), coworker) }))
    const app: Tile[] = icons.app ? [{ id: APP_ID, position: APP_AT, span: 1, style: connectorTileStyle(icons.app) }] : []
    return {
        tiles: [focus, ...neighbours, ...app],
        links: app.map((tile): TileLink => ({ source: FOCUS_ID, target: tile.id, variant: 'cable' })),
        ...frameTemplateBoard([focus, ...app], ALERT_BOARD_SIZE, MAX_ZOOM, COWORKER_INSET),
    }
}
