// How a coworker's screen fills the frame on a touch screen: enlarged `scale` times, with the point
// (`centerX`, `centerY`, from 0 to 1 across the screen) in the middle of the frame. Tied to the screen
// rather than to the frame's pixels, a view keeps its place when the frame changes size (a keyboard
// opening, a rotation).
export type ScreenView = { scale: number; centerX: number; centerY: number }
export type Point = { x: number; y: number }
export type Size = { width: number; height: number }

export const SCREEN_VIEW_AT_REST: ScreenView = { scale: 1, centerX: 0.5, centerY: 0.5 }

export const DEFAULT_SCREEN_ASPECT = 16 / 9

const MAX_SCREEN_SCALE = 4

// noVNC fits the screen inside its element without stretching it and centers it, leaving bands
// on the sides that do not match the frame's shape.
function fitted(frame: Size, aspect: number): Size {
    const width = Math.min(frame.width, frame.height * aspect)
    return { width, height: width / aspect }
}

// A screen larger than the frame covers it; one that is smaller stays centered.
function coveringCenter(center: number, screenLength: number, frameLength: number): number {
    if (screenLength <= frameLength) return 0.5
    const half = frameLength / (2 * screenLength)
    return Math.min(1 - half, Math.max(half, center))
}

function clampView(view: ScreenView, frame: Size, aspect: number): ScreenView {
    const scale = Math.min(MAX_SCREEN_SCALE, Math.max(1, view.scale))
    const screen = fitted(frame, aspect)
    return {
        scale,
        centerX: coveringCenter(view.centerX, screen.width * scale, frame.width),
        centerY: coveringCenter(view.centerY, screen.height * scale, frame.height),
    }
}

// `start` brought to `scale`, the point of the screen under `focal` kept under it.
export function zoomView(start: ScreenView, scale: number, focal: Point, frame: Size, aspect: number): ScreenView {
    const from = clampView(start, frame, aspect)
    const screen = fitted(frame, aspect)
    if (!screen.width || !screen.height) return from
    const next = Math.min(MAX_SCREEN_SCALE, Math.max(1, scale))
    const toNext = (center: number, focalAt: number, frameLength: number, screenLength: number) => {
        const underFocal = center + (focalAt - frameLength / 2) / (from.scale * screenLength)
        return underFocal - (focalAt - frameLength / 2) / (next * screenLength)
    }
    return clampView({ scale: next, centerX: toNext(from.centerX, focal.x, frame.width, screen.width), centerY: toNext(from.centerY, focal.y, frame.height, screen.height) }, frame, aspect)
}

// `start` moved with a finger that travelled `dx`, `dy` pixels of the frame.
export function panView(start: ScreenView, dx: number, dy: number, frame: Size, aspect: number): ScreenView {
    const from = clampView(start, frame, aspect)
    const screen = fitted(frame, aspect)
    if (!screen.width || !screen.height) return from
    return clampView({ scale: from.scale, centerX: from.centerX - dx / (from.scale * screen.width), centerY: from.centerY - dy / (from.scale * screen.height) }, frame, aspect)
}

// Where the screen's element goes: `scale` times the frame, so noVNC rescales the screen itself and a
// tap still lands on the pixel under the finger, moved by `x`, `y` pixels.
export function screenPlacement(view: ScreenView, frame: Size, aspect: number): { scale: number; x: number; y: number } {
    const { scale, centerX, centerY } = clampView(view, frame, aspect)
    const screen = fitted(frame, aspect)
    const offset = (center: number, frameLength: number, screenLength: number) => frameLength / 2 - center * scale * screenLength - (scale * (frameLength - screenLength)) / 2
    return { scale, x: offset(centerX, frame.width, screen.width), y: offset(centerY, frame.height, screen.height) }
}
