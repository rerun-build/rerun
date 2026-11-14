import type { ModelPillItem } from '../beams'

const SLOT_OFFSETS: readonly { x: number; y: number }[] = [
    { x: -326, y: -78 },
    { x: 288, y: -34 },
    { x: -272, y: 52 },
    { x: 338, y: 92 },
    { x: -348, y: 170 },
    { x: 300, y: 198 },
]

const WIDEST_SLOT = Math.max(...SLOT_OFFSETS.map(offset => Math.abs(offset.x)))
const TALLEST_SLOT = Math.max(...SLOT_OFFSETS.map(offset => Math.abs(offset.y)))

const PILL_HALF_W = 108
const PILL_HALF_H = 22
const MIN_SPREAD = 0.15

const TIGHT_SPREAD = 0.85

export type TourModelShot = { slots: readonly { x: number; y: number }[]; visible: number }

const VISIBLE_BEATS = 3

function squeeze(room: number, reach: number) {
    if (reach <= 0) return 1
    return Math.min(1, Math.max(MIN_SPREAD, room / reach))
}

export function tourModelShot(camera: { pan: { x: number; y: number }; zoom: number }, frame: { width: number; height: number }): TourModelShot {
    const spreadX = squeeze(frame.width / 2 - PILL_HALF_W, WIDEST_SLOT)
    const spreadY = squeeze(frame.height / 2 - PILL_HALF_H, TALLEST_SLOT)
    const center = { x: -camera.pan.x, y: -camera.pan.y }
    return {
        slots: SLOT_OFFSETS.map(offset => ({ x: center.x + (offset.x * spreadX) / camera.zoom, y: center.y + (offset.y * spreadY) / camera.zoom })),
        visible: spreadX < TIGHT_SPREAD ? VISIBLE_BEATS - 1 : VISIBLE_BEATS,
    }
}

type TourModelBeat = { slot: number; model: ModelPillItem; hold: number }

export const TOUR_MODEL_BEATS: readonly TourModelBeat[] = [
    { slot: 0, model: { name: 'Claude Opus 4.8', logo: 'anthropic' }, hold: 1875 },
    { slot: 3, model: { name: 'GPT-5.6 Sol', logo: 'openai' }, hold: 1650 },
    { slot: 4, model: { name: 'Gemini 3.1 Pro', logo: 'googlegemini' }, hold: 2000 },
    { slot: 1, model: { name: 'Grok 4.6', logo: 'grok' }, hold: 1700 },
    { slot: 2, model: { name: 'Kimi K2.6', logo: 'moonshotai' }, hold: 1925 },
    { slot: 5, model: { name: 'DeepSeek V4 Pro', logo: 'deepseek' }, hold: 1575 },
    { slot: 0, model: { name: 'GLM-5.2', logo: 'zhipu' }, hold: 2050 },
    { slot: 1, model: { name: 'Qwen3.8 Max', logo: 'qwen' }, hold: 1750 },
    { slot: 2, model: { name: 'Claude Fable 5', logo: 'anthropic' }, hold: 1875 },
    { slot: 3, model: { name: 'MiniMax M3', logo: 'minimax' }, hold: 1650 },
    { slot: 4, model: { name: 'Mistral Large 3', logo: 'mistralai' }, hold: 2000 },
    { slot: 5, model: { name: 'GPT-5.6 Terra', logo: 'openai' }, hold: 1750 },
    { slot: 2, model: { name: 'Claude Sonnet 5', logo: 'anthropic' }, hold: 1925 },
    { slot: 1, model: { name: 'Gemini 3.5 Flash', logo: 'googlegemini' }, hold: 1700 },
]

export type TourModelPill = { key: string; x: number; y: number; item: ModelPillItem }

export function tourModelPillsAt(index: number, shot: TourModelShot): TourModelPill[] {
    const pills: TourModelPill[] = []
    for (let back = shot.visible - 1; back >= 0; back--) {
        const at = index - back
        if (at < 0) continue
        const beat = TOUR_MODEL_BEATS[at % TOUR_MODEL_BEATS.length]
        const slot = shot.slots[beat.slot]
        pills.push({ key: `${at}`, x: slot.x, y: slot.y, item: beat.model })
    }
    return pills
}

export function tourModelStillPills(shot: TourModelShot): TourModelPill[] {
    return [
        { key: 'still-claude', ...shot.slots[0], item: { name: 'Claude Opus 4.8', logo: 'anthropic' } },
        { key: 'still-gpt', ...shot.slots[1], item: { name: 'GPT-5.6 Sol', logo: 'openai' } },
    ]
}

export const TOUR_MODEL_PILLS_START = 1400
