'use client'

import { ISO_ZOOM, type IsoViewRequest } from '@rerun/ui/iso-grid'
import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { boardKeyAllowed, boardShortcutFor, shortcutRepeats, type BoardShortcut } from '@/lib/board/board-shortcuts'
import { SIDE_PANEL_GAP, loadSidePanelWidth } from '@/lib/side-panel-width'
import { useBoardStore } from '@/stores/board.store'

// `insetRight` is what the coworker's panel covers on the right when the key was pressed.
export type BoardKeyHud = { keys: string[]; text: string; insetRight: number; id: number }

type ShortcutBox = { id: string; name: string }

const HUD_MS = 1400

const KEY_LABEL: Record<Exclude<BoardShortcut['kind'], 'fitBox'>, string> = { zoomIn: '+', zoomOut: '−', fitAll: '0' }

// The board's keys: + and − zoom, 0 fits the whole board, 1 to 9 fit and select the Box of that
// number. `boxes` come in the order their numbers are drawn on the board.
export function useBoardShortcuts({ enabled, boxes, zoomRef, insetRight }: { enabled: boolean; boxes: ShortcutBox[]; zoomRef: React.RefObject<number>; insetRight: () => number }) {
    const t = useTranslations('builder.isoBoard.keys')
    const locale = useLocale()
    const [viewRequest, setViewRequest] = useState<IsoViewRequest | null>(null)
    const [hud, setHud] = useState<BoardKeyHud | null>(null)
    const nonce = useRef(0)

    const onKey = useEffectEvent((event: KeyboardEvent) => {
        if (event.defaultPrevented || !boardKeyAllowed(event)) return
        const shortcut = boardShortcutFor(event)
        if (!shortcut || (event.repeat && !shortcutRepeats(shortcut))) return
        event.preventDefault()
        const show = (keys: string[], text: string) => setHud({ keys, text, insetRight: insetRight(), id: ++nonce.current })

        switch (shortcut.kind) {
            case 'zoomIn':
            case 'zoomOut': {
                const zoom = shortcut.kind === 'zoomIn' ? Math.min(ISO_ZOOM.max, zoomRef.current * ISO_ZOOM.step) : Math.max(ISO_ZOOM.min, zoomRef.current / ISO_ZOOM.step)
                // Held down, the key repeats before the board reports its new zoom.
                zoomRef.current = zoom
                setViewRequest({ kind: shortcut.kind, nonce: ++nonce.current })
                show([KEY_LABEL[shortcut.kind]], formatNumber(zoom, locale, { style: 'percent', maximumFractionDigits: 0 }))
                return
            }
            case 'fitAll':
                useBoardStore.getState().recenterBoard()
                show([KEY_LABEL.fitAll], t('wholeBoard'))
                return
            case 'fitBox': {
                const number = shortcut.index + 1
                const box = boxes[shortcut.index]
                if (!box) {
                    show([String(number)], t('noBox', { number }))
                    return
                }
                useBoardStore.getState().selectSpace(box.id)
                setViewRequest({ kind: 'fitContainer', containerId: box.id, insetRight: insetRight(), nonce: ++nonce.current })
                show([String(number)], box.name)
                return
            }
        }
    })

    useEffect(() => {
        if (!enabled) return
        const listener = (event: KeyboardEvent) => onKey(event)
        window.addEventListener('keydown', listener)
        return () => window.removeEventListener('keydown', listener)
    }, [enabled])

    useEffect(() => {
        if (!hud) return
        const timer = setTimeout(() => setHud(null), HUD_MS)
        return () => clearTimeout(timer)
    }, [hud])

    return { viewRequest, hud }
}

export function agentPanelInset(belowMd: boolean) {
    if (belowMd || !useBoardStore.getState().selectedAgentId) return 0
    return loadSidePanelWidth(window.innerWidth) + SIDE_PANEL_GAP
}
