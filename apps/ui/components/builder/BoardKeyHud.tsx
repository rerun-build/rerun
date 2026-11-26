'use client'

import { Kbd } from '@/components/ui/kbd'
import type { BoardKeyHud as Hud } from './useBoardShortcuts'

// What the key just pressed did, above the board's bottom toolbar (under its top bar on a small screen),
// centred in what the coworker's panel leaves of the board.
export function BoardKeyHud({ hud }: { hud: Hud | null }) {
    return (
        <div
            aria-live="polite"
            data-board-key-hud
            style={{ insetInlineEnd: hud?.insetRight ?? 0 }}
            className="pointer-events-none absolute top-[calc(var(--chrome-edge)+var(--chrome-size)+0.5rem)] start-0 z-40 flex justify-center px-4 md:top-auto md:bottom-[calc(var(--chrome-edge)+var(--chrome-size)+0.75rem+var(--consent-inset))]"
        >
            {hud && (
                <div key={hud.id} className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur">
                    <span className="flex shrink-0 items-center gap-1">
                        {hud.keys.map(key => (
                            <Kbd key={key}>{key}</Kbd>
                        ))}
                    </span>
                    <span className="min-w-0 truncate">{hud.text}</span>
                </div>
            )}
        </div>
    )
}
