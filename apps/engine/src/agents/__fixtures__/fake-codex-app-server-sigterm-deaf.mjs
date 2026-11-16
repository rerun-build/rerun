// Stands in for a `codex app-server` the engine cannot signal: SIGTERM does nothing, the way a kill
// refused with EACCES leaves it running. Like the real app-server, it exits once its stdin closes,
// unless STAY_AFTER_EOF is set: then nothing short of SIGKILL stops it.
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

process.on('SIGTERM', () => {})
if (process.env.PID_FILE) writeFileSync(process.env.PID_FILE, String(process.pid))

const THREAD_ID = 'thread-1'
const TURN_ID = 'turn-1'

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`)
const turn = status => ({ id: TURN_ID, items: [], status, error: null })

const lines = createInterface({ input: process.stdin })
lines.on('close', () => (process.env.STAY_AFTER_EOF ? setInterval(() => {}, 1_000) : process.exit(0)))
lines.on('line', line => {
    const { id, method } = JSON.parse(line)
    if (method === 'initialize') send({ id, result: { userAgent: 'codex_cli_rs/0.166.0', capabilities: {} } })
    if (method === 'thread/start' || method === 'thread/resume') send({ id, result: { thread: { id: THREAD_ID } } })
    if (method === 'turn/start') {
        send({ id, result: { turn: turn('inProgress') } })
        send({ method: 'turn/started', params: { threadId: THREAD_ID, turn: turn('inProgress') } })
        send({ method: 'turn/completed', params: { threadId: THREAD_ID, turn: turn('completed') } })
    }
})
