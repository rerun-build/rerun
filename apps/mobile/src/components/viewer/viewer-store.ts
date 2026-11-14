import { useSyncExternalStore } from 'react'

export type ViewerItem = { url: string; name: string; image?: boolean }

type ViewerState = { items: ViewerItem[]; index: number } | null

let state: ViewerState = null
const listeners = new Set<() => void>()

function emit() {
    for (const listener of listeners) listener()
}

export function openViewer(items: ViewerItem[], index = 0) {
    if (items.length === 0) return
    state = { items, index: Math.max(0, Math.min(index, items.length - 1)) }
    emit()
}

export function closeViewer() {
    state = null
    emit()
}

export function useViewerState(): ViewerState {
    return useSyncExternalStore(
        listener => {
            listeners.add(listener)
            return () => listeners.delete(listener)
        },
        () => state
    )
}

const IMAGE = /\.(png|jpe?g|gif|webp|heic|heif|avif|bmp)$/i

export const isImageItem = (item: ViewerItem) => item.image ?? IMAGE.test(item.name.split(/[?#]/)[0])
