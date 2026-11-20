// The web Foreman's idle life (packages/ui/src/foreman/Orb.tsx, orb-tuning.ts, foreman-face.tsx),
// as worklets: the eyes drift, the whole ball turns as if looking around, a band of light crosses
// the glass and, while it thinks, the ball spins on itself now and then.

export const ORB_RADIUS = 40
export const ORB_CENTER = { x: 50, y: 44 }
const FACE_AT = { x: ORB_CENTER.x - 9, y: ORB_CENTER.y - 3 }
const FACE_LEAN = 0.2
const MAX_FACE_LEAN = 0.35

const REST_PITCH = Math.asin((ORB_CENTER.y - FACE_AT.y) / ORB_RADIUS)
const REST_YAW = Math.asin((FACE_AT.x - ORB_CENTER.x) / (ORB_RADIUS * Math.cos(REST_PITCH)))

export type OrbFacing = 'left' | 'right'

export function restPose(facing: OrbFacing) {
    'worklet'
    return { yaw: facing === 'left' ? REST_YAW : -REST_YAW, pitch: REST_PITCH }
}

// [a b c d e f] as in SVG's matrix().
export type Matrix = [number, number, number, number, number, number]

// The `transform` of a view whose drawing is moved by `matrix`: `centre` is the point of the drawing
// that sits at the middle of the view, `scale` how many points one of its units takes. A view's
// transform never goes through a commit of the tree nor redraws what is inside, which a matrix set on
// an SVG group does on every frame.
export function layerTransform(matrix: Matrix, scale: number, centre: { x: number; y: number } = { x: 0, y: 0 }) {
    'worklet'
    const [a, b, c, d, e, f] = matrix
    const dx = a * centre.x + c * centre.y + e - centre.x
    const dy = b * centre.x + d * centre.y + f - centre.y
    return [{ matrix: [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, dx * scale, dy * scale, 0, 1] }]
}

// The face carried by a ball turned by `yaw` (to the right) and `pitch` (upwards): it slides over the
// sphere, flattens as it nears the rim and is gone once it has turned to the far side. The web's
// translate(x y) matrix(1 lean 0 1 0 0) scale(sx sy), folded into one matrix.
export function facePose(yaw: number, pitch: number): { matrix: Matrix; shown: boolean } {
    'worklet'
    const towards = Math.cos(yaw)
    if (towards <= 0) return { matrix: [0, 0, 0, 0, ORB_CENTER.x, ORB_CENTER.y], shown: false }
    const x = ORB_CENTER.x + ORB_RADIUS * Math.sin(yaw) * Math.cos(pitch)
    const y = ORB_CENTER.y - ORB_RADIUS * Math.sin(pitch)
    const lean = Math.max(-MAX_FACE_LEAN, Math.min(MAX_FACE_LEAN, (FACE_LEAN * Math.sin(yaw)) / Math.sin(REST_YAW)))
    const scaleX = towards / Math.cos(REST_YAW)
    const scaleY = Math.cos(pitch) / Math.cos(REST_PITCH)
    return { matrix: [scaleX, lean * scaleX, 0, scaleY, x, y], shown: true }
}

type Tuning = { gaze: number; gazeRate: number; turn: number; turnRate: number; sheenPeriod: number }

const TUNING: { idle: Tuning; thinking: Tuning } = {
    idle: { gaze: 0.8, gazeRate: 0.35, turn: 16, turnRate: 0.45, sheenPeriod: 6 },
    thinking: { gaze: 3, gazeRate: 1.9, turn: 40, turnRate: 1.6, sheenPeriod: 1.8 },
}

const WANDER = 0.5
const DEGREES = Math.PI / 180
const SPIN_SECONDS = 0.7
const SPIN_EVERY = 5
// How far the band of light travels, and the share of its period spent crossing; it rests the rest.
export const SHEEN_TRAVEL = 170
const SHEEN_CROSSING = 0.55

export type OrbClock = {
    tuning: Tuning
    gaze: number
    turn: number
    sheen: number
    spin: number
    spinSide: number
    nextSpin: number
}

export function startClock(): OrbClock {
    return { tuning: { ...TUNING.idle }, gaze: 0, turn: 0, sheen: 0, spin: 1, spinSide: 1, nextSpin: 0 }
}

export type OrbPose = { face: Matrix; faceShown: boolean; eyes: Matrix; sheen: Matrix }

export function restingPose(facing: OrbFacing): OrbPose {
    'worklet'
    const rest = restPose(facing)
    const face = facePose(rest.yaw, rest.pitch)
    return { face: face.matrix, faceShown: true, eyes: [1, 0, 0, 1, 0, 0], sheen: [1, 0, 0, 1, 0, 0] }
}

function easeInOut(progress: number) {
    'worklet'
    return progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2
}

// Moves `clock` on by `dt` seconds, in place, and returns where everything is drawn.
export function advance(clock: OrbClock, dt: number, thinking: boolean, facing: OrbFacing): OrbPose {
    'worklet'
    const target = thinking ? TUNING.thinking : TUNING.idle
    const tuning = clock.tuning
    // A change of state never jumps: the ball speeds up or calms down over a second or so.
    const k = 1 - Math.exp(-dt * 2.6)
    tuning.gaze += (target.gaze - tuning.gaze) * k
    tuning.gazeRate += (target.gazeRate - tuning.gazeRate) * k
    tuning.turn += (target.turn - tuning.turn) * k
    tuning.turnRate += (target.turnRate - tuning.turnRate) * k
    tuning.sheenPeriod += (target.sheenPeriod - tuning.sheenPeriod) * k

    // Two sines at unrelated rates: a single one would swing like a metronome and read as a loop.
    clock.gaze += dt * tuning.gazeRate
    const wander = (Math.sin(clock.gaze * 1.7) * 0.6 + Math.sin(clock.gaze * 4.3 + 1.1) * 0.4) * WANDER * tuning.gaze
    const lift = (Math.sin(clock.gaze * 1.1 + 2.3) * 0.5 + Math.sin(clock.gaze * 3.1) * 0.3) * WANDER * tuning.gaze * 0.55

    clock.turn += dt * tuning.turnRate
    const sweep = (Math.sin(clock.turn * 1.3) * 0.65 + Math.sin(clock.turn * 2.9 + 0.7) * 0.35) * tuning.turn * DEGREES
    const tilt = (Math.sin(clock.turn * 0.9 + 1.9) * 0.6 + Math.sin(clock.turn * 2.3) * 0.4) * tuning.turn * 0.38 * DEGREES

    if (thinking) {
        clock.nextSpin -= dt
        if (clock.nextSpin <= 0 && clock.spin >= 1) {
            clock.spin = 0
            clock.spinSide = -clock.spinSide
            clock.nextSpin = SPIN_EVERY * (0.8 + Math.random() * 0.4)
        }
    } else {
        clock.nextSpin = 0
    }
    clock.spin = Math.min(1, clock.spin + dt / SPIN_SECONDS)
    const spin = clock.spin < 1 ? easeInOut(clock.spin) * 2 * Math.PI * clock.spinSide : 0

    clock.sheen = (clock.sheen + dt / tuning.sheenPeriod) % 1
    const crossing = Math.min(1, clock.sheen / SHEEN_CROSSING)

    const rest = restPose(facing)
    const face = facePose(rest.yaw + sweep + spin, rest.pitch + tilt)
    return { face: face.matrix, faceShown: face.shown, eyes: [1, 0, 0, 1, wander, lift], sheen: [1, 0, 0, 1, easeInOut(crossing) * SHEEN_TRAVEL, 0] }
}
