import { execFile } from 'node:child_process'
import { BAR_WINDOW_NAME, DOCK_WINDOW_NAME } from './panels.js'
import { SCREEN_CAPTURE_BINARY, desktopEnv, ensureDesktop } from './session.js'

const SCREEN_PROFILES = {
    standard: { width: 1280, height: 720, quality: 75 },
    small: { width: 800, height: 450, quality: 60 },
} as const
const CAPTURE_MAX_BYTES = 64 * 1024 * 1024
const TYPE_DELAY_MS = '12'
const DOUBLE_CLICK_DELAY_MS = '80'
const PANEL_WINDOW_NAMES = new Set([DOCK_WINDOW_NAME, BAR_WINDOW_NAME])
const BUTTONS = { left: '1', right: '3' } as const
const SCROLL_BUTTONS = { up: '4', down: '5', left: '6', right: '7' } as const
const KEY_COMBO = /^[A-Za-z0-9_]+(\+[A-Za-z0-9_]+)*$/
const FUNCTION_KEY = /^f\d{1,2}$/
const KEY_ALIASES: Record<string, string> = {
    enter: 'Return',
    return: 'Return',
    esc: 'Escape',
    escape: 'Escape',
    backspace: 'BackSpace',
    delete: 'Delete',
    del: 'Delete',
    tab: 'Tab',
    space: 'space',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    arrowup: 'Up',
    arrowdown: 'Down',
    arrowleft: 'Left',
    arrowright: 'Right',
    pageup: 'Page_Up',
    page_up: 'Page_Up',
    pagedown: 'Page_Down',
    page_down: 'Page_Down',
    home: 'Home',
    end: 'End',
    insert: 'Insert',
    ctrl: 'ctrl',
    control: 'ctrl',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
    super: 'super',
    cmd: 'super',
    command: 'super',
    meta: 'super',
    win: 'super',
}

export type ViewPoint = readonly [number, number]
export type MouseButton = keyof typeof BUTTONS
export type ScrollDirection = keyof typeof SCROLL_BUTTONS
export type Screenshot = { image: Buffer; mediaType: 'image/jpeg'; width: number; height: number }

export type ScreenProfile = keyof typeof SCREEN_PROFILES
export type ScreenControl = { env: NodeJS.ProcessEnv; width: number; height: number; scale: number; quality: number; signal?: AbortSignal }

export function screenProfile(env: NodeJS.ProcessEnv = process.env): ScreenProfile {
    return env.RERUN_SCREEN_PROFILE === 'small' ? 'small' : 'standard'
}

export class ControlRefusal extends Error {}

type RunOptions = { signal?: AbortSignal; input?: string }

function run(command: string, args: string[], env: NodeJS.ProcessEnv, { signal, input }: RunOptions = {}): Promise<Buffer> {
    return new Promise((done, failed) => {
        const child = execFile(command, args, { env, signal, encoding: 'buffer', maxBuffer: CAPTURE_MAX_BYTES }, (err, stdout) => (err ? failed(err) : done(stdout)))
        if (input !== undefined) child.stdin?.end(input)
    })
}

const xdotool = (control: ScreenControl, args: string[], options: RunOptions = {}): Promise<Buffer> => run('xdotool', args, control.env, { signal: control.signal, ...options })

export async function controlScreen(agentId: string, signal?: AbortSignal, profile: ScreenProfile = 'standard'): Promise<ScreenControl> {
    const { display } = await ensureDesktop(agentId)
    const env = desktopEnv(display)
    const [width = 0, height = 0] = (await run('xdotool', ['getdisplaygeometry'], env, { signal })).toString().trim().split(/\s+/).map(Number)
    if (!width || !height) throw new Error('The screen did not report its size.')
    const view = SCREEN_PROFILES[profile]
    return { env, width, height, scale: Math.max(1, width / view.width, height / view.height), quality: view.quality, signal }
}

export async function captureScreen(control: ScreenControl): Promise<Screenshot> {
    const png = await run(SCREEN_CAPTURE_BINARY, ['--format', 'png'], control.env, { signal: control.signal })
    const { default: sharp } = await import('sharp')
    const width = Math.round(control.width / control.scale)
    const height = Math.round(control.height / control.scale)
    const image = await sharp(png).resize(width, height, { fit: 'fill' }).jpeg({ quality: control.quality }).toBuffer()
    return { image, mediaType: 'image/jpeg', width, height }
}

function onScreen(control: ScreenControl, [x, y]: ViewPoint): [string, string] {
    const clamp = (value: number, size: number) => String(Math.min(size - 1, Math.max(0, Math.round(value * control.scale))))
    return [clamp(x, control.width), clamp(y, control.height)]
}

async function refusePanel(control: ScreenControl): Promise<void> {
    const location = (await xdotool(control, ['getmouselocation', '--shell'])).toString()
    const window = /^WINDOW=(\d+)$/m.exec(location)?.[1]
    if (!window) return
    const name = await xdotool(control, ['getwindowname', window]).then(
        out => out.toString().trim(),
        () => '',
    )
    if (PANEL_WINDOW_NAMES.has(name)) throw new ControlRefusal('The dock and the top bar are not yours to click. Open an app with computer_open_app instead.')
}

export async function movePointer(control: ScreenControl, point: ViewPoint): Promise<void> {
    await xdotool(control, ['mousemove', '--sync', ...onScreen(control, point)])
}

export async function click(control: ScreenControl, point: ViewPoint, { button = 'left', double = false }: { button?: MouseButton; double?: boolean } = {}): Promise<void> {
    await movePointer(control, point)
    await refusePanel(control)
    await xdotool(control, ['click', ...(double ? ['--repeat', '2', '--delay', DOUBLE_CLICK_DELAY_MS] : []), BUTTONS[button]])
}

export async function drag(control: ScreenControl, from: ViewPoint, to: ViewPoint): Promise<void> {
    await movePointer(control, from)
    await refusePanel(control)
    try {
        await xdotool(control, ['mousedown', BUTTONS.left])
        await movePointer(control, to)
    } finally {
        await run('xdotool', ['mouseup', BUTTONS.left], control.env).catch(() => {})
    }
}

export async function scroll(control: ScreenControl, point: ViewPoint, direction: ScrollDirection, amount: number): Promise<void> {
    await movePointer(control, point)
    await refusePanel(control)
    await xdotool(control, ['click', '--repeat', String(amount), SCROLL_BUTTONS[direction]])
}

export async function typeText(control: ScreenControl, text: string): Promise<void> {
    await xdotool(control, ['type', '--delay', TYPE_DELAY_MS, '--file', '-'], { input: text })
}

function keyName(part: string): string {
    const lower = part.toLowerCase()
    if (FUNCTION_KEY.test(lower)) return lower.toUpperCase()
    return KEY_ALIASES[lower] ?? part
}

export function keyCombos(keys: string): string[] {
    const combos = keys.trim().split(/\s+/).filter(Boolean)
    if (combos.length === 0) throw new ControlRefusal('Name the key to press, for example "Return" or "ctrl+a".')
    return combos.map(combo => {
        if (!KEY_COMBO.test(combo)) throw new ControlRefusal(`"${combo}" is not a key. Name keys like "Return", "Escape", "ctrl+a" or "shift+Tab".`)
        return combo.split('+').map(keyName).join('+')
    })
}

export async function pressKeys(control: ScreenControl, keys: string): Promise<void> {
    for (const combo of keyCombos(keys)) {
        try {
            await xdotool(control, ['key', '--', combo])
        } catch (err) {
            await run('xdotool', ['keyup', '--', combo], control.env).catch(() => {})
            throw err
        }
    }
}
