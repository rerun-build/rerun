'use client'

import { createContext, useContext, type ReactNode } from 'react'

// The camera's zoom, snapped down to a few steps: a material's relief and fibres depend on how many
// pixels the block really takes, and a pinch changes the zoom on every frame. Snapped, the buddies
// only draw again when a step is crossed, and rounding down flattens a little early, never too late.
const DETAIL_ZOOM_STEPS = [1, 0.7, 0.5, 0.3]

export function detailZoom(zoom: number) {
    return DETAIL_ZOOM_STEPS.find(step => zoom >= step) ?? zoom
}

const BuddyZoom = createContext(1)

export function BuddyZoomProvider({ zoom, children }: { zoom: number; children: ReactNode }) {
    return <BuddyZoom.Provider value={zoom}>{children}</BuddyZoom.Provider>
}

export function useBuddyZoom() {
    return useContext(BuddyZoom)
}
