'use client'

import { IsoGrid } from '@rerun/ui/iso-grid'
import { type ReactElement, useMemo } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ProviderIcon } from '@/lib/engine/provider-icons'
import { CoinsIcon, CreditCardIcon } from '@/lib/icons'
import { ALERT_BOARD_SIZE, type AlertBoard, type AlertCause } from '@/lib/og/alert-board'
import { stageAlertBoard } from '@/lib/og/alert-board-tiles'

// A tile only takes an image: the icon travels as one, drawn for a dark tile.
function iconUrl(icon: ReactElement): string {
    const svg = renderToStaticMarkup(icon).replaceAll('currentColor', '#fafafa')
    const standalone = svg.includes('xmlns=') ? svg : svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
    return `data:image/svg+xml,${encodeURIComponent(standalone)}`
}

function causeIcon(cause: AlertCause): string {
    if (cause === 'credits') return iconUrl(<CoinsIcon />)
    if (cause === 'payment') return iconUrl(<CreditCardIcon />)
    return iconUrl(<ProviderIcon provider={cause} />)
}

export function AlertBoardStage({ board, appIcon }: { board: AlertBoard; appIcon: string | null }) {
    const { tiles, links, pan, zoom } = useMemo(() => stageAlertBoard(board, { app: appIcon, cause: board.kind === 'cause' ? causeIcon(board.cause) : undefined }), [board, appIcon])

    return (
        <div className="dark relative overflow-hidden bg-[#0a0a0a]" style={ALERT_BOARD_SIZE}>
            <IsoGrid tiles={tiles} containers={[]} liveLinks={links} initialPan={pan} initialZoomDesktop={zoom} initialZoomMobile={zoom} scrollGestures={false} canDraw={false} mask="none" />
        </div>
    )
}
