'use client'

import { MousePointer2Icon } from '@/lib/icons'

// Covers a screen whose parent is a `group`: hovering it darkens the screen and names what a click does.
export function TakeControlOverlay({ label, onClick }: { label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/0 outline-none transition-colors group-hover:bg-black/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
            <span className="flex items-center gap-1.5 rounded-full bg-background/90 px-3 py-1.5 text-xs font-medium whitespace-nowrap opacity-0 shadow-sm backdrop-blur transition-opacity group-hover:opacity-100 [:focus-visible>&]:opacity-100">
                <MousePointer2Icon className="size-3.5" />
                {label}
            </span>
        </button>
    )
}
