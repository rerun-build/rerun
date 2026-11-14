import type { OrbActivity } from './Orb'

export type OrbTuning = {
    amp: number
    churn: number
    breathe: number
    breatheRate: number
    bloom: number
    gaze: number
    gazeRate: number
    openness: number
    blinkEvery: number
    turn: number
    turnRate: number
    nod: number
}

export const ORB_TUNING: Record<OrbActivity, OrbTuning> = {
    idle: { amp: 1, churn: 0.5, breathe: 0.016, breatheRate: 0.55, bloom: 0.75, gaze: 0.8, gazeRate: 0.35, openness: 1, blinkEvery: 4.6, turn: 16, turnRate: 0.45, nod: 0 },
    listening: { amp: 1.25, churn: 0.95, breathe: 0.034, breatheRate: 1.1, bloom: 1, gaze: 1.5, gazeRate: 0.6, openness: 1.2, blinkEvery: 6.4, turn: 9, turnRate: 0.7, nod: 0 },
    thinking: { amp: 1.5, churn: 2.5, breathe: 0.013, breatheRate: 2.4, bloom: 0.92, gaze: 3, gazeRate: 1.9, openness: 0.74, blinkEvery: 2.1, turn: 40, turnRate: 1.6, nod: 0 },
    speaking: { amp: 1.35, churn: 1.45, breathe: 0.052, breatheRate: 3.1, bloom: 1.2, gaze: 1.1, gazeRate: 0.8, openness: 0.94, blinkEvery: 5.2, turn: 4, turnRate: 0.8, nod: 7 },
}

export function approachTuning(current: OrbTuning, target: OrbTuning, dt: number) {
    const k = 1 - Math.exp(-dt * 2.6)
    for (const key of Object.keys(current) as (keyof OrbTuning)[]) {
        current[key] += (target[key] - current[key]) * k
    }
}
