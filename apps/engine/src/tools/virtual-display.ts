import { spawn, type ChildProcess } from 'node:child_process'
import type { Readable } from 'node:stream'

const XVFB_ARGS = ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp']
const START_TIMEOUT_MS = 5_000
const IDLE_STOP_MS = 60_000

type Xvfb = { display: string; child: ChildProcess }
type Slot = { xvfb: Promise<Xvfb | null>; uses: number; idleTimer: NodeJS.Timeout | null }

export type DisplayHold = { display: string | null; release: () => void }

const slots = new Map<string, Slot>()
const running = new Set<ChildProcess>()
let exitHooked = false

const NOTHING_TO_RELEASE = () => {}

export async function holdDisplay(agentId: string): Promise<DisplayHold> {
    if (process.env.DISPLAY) return { display: process.env.DISPLAY, release: NOTHING_TO_RELEASE }
    if (process.platform !== 'linux') return { display: null, release: NOTHING_TO_RELEASE }
    const slot = slots.get(agentId) ?? openSlot(agentId)
    slot.uses++
    if (slot.idleTimer) clearTimeout(slot.idleTimer)
    slot.idleTimer = null
    const xvfb = await slot.xvfb
    let released = false
    return {
        display: xvfb?.display ?? null,
        release: () => {
            if (released) return
            released = true
            slot.uses--
            if (slot.uses > 0 || slots.get(agentId) !== slot) return
            slot.idleTimer = setTimeout(() => xvfb?.child.kill(), IDLE_STOP_MS)
            slot.idleTimer.unref()
        },
    }
}

function openSlot(agentId: string): Slot {
    const slot: Slot = {
        uses: 0,
        idleTimer: null,
        xvfb: startXvfb(() => {
            if (slot.idleTimer) clearTimeout(slot.idleTimer)
            if (slots.get(agentId) === slot) slots.delete(agentId)
        }),
    }
    slots.set(agentId, slot)
    return slot
}

function killRunningOnExit(): void {
    if (exitHooked) return
    exitHooked = true
    process.once('exit', () => running.forEach(child => child.kill()))
}

function startXvfb(onGone: () => void): Promise<Xvfb | null> {
    return new Promise(resolve => {
        const child = spawn('Xvfb', XVFB_ARGS, { stdio: ['ignore', 'ignore', 'ignore', 'pipe'] })
        const displayFd = child.stdio[3] as Readable
        const timer = setTimeout(() => child.kill(), START_TIMEOUT_MS)
        const settle = (value: Xvfb | null) => {
            clearTimeout(timer)
            displayFd.destroy()
            resolve(value)
        }
        const gone = () => {
            running.delete(child)
            onGone()
            settle(null)
        }
        let written = ''
        displayFd.on('data', (chunk: Buffer) => {
            written += chunk.toString()
            const number = /^(\d+)\n/.exec(written)?.[1]
            if (number) settle({ display: `:${number}`, child })
        })
        child.once('error', gone)
        child.once('exit', gone)
        running.add(child)
        killRunningOnExit()
        child.unref()
    })
}
