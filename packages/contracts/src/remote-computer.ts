import { z } from 'zod'

// A computer a person linked to a workspace from the desktop app: the hands of the workspace's
// coworkers on that machine. The coworker stays on the box; the computer runs what it is asked
// (commands, files, long jobs, its screen) over one WebSocket it opens to the engine. Shared by the
// engine (`apps/engine/src/remote`), the hub and the desktop app's worker, which stays installed for
// months: both ends announce the protocol versions they speak and agree on the highest common one.

export const REMOTE_WS_PATH = '/remote/ws'

export const REMOTE_PROTOCOL_MIN = 1
export const REMOTE_PROTOCOL_MAX = 1

export const REMOTE_TICKET_TTL_MS = 60_000

// Sent by both ends; a peer that misses two in a row is gone, whatever the TCP socket believes.
export const REMOTE_PING_INTERVAL_MS = 25_000
export const REMOTE_MISSED_PINGS = 2

// Why the engine closes a computer's socket. The computer reconnects after any of them but
// `revoked`, which tells it the link is gone.
export const REMOTE_CLOSE = {
    noHello: 4001,
    badHello: 4002,
    protocol: 4003,
    replaced: 4004,
    revoked: 4005,
    unresponsive: 4006,
} as const

// The engine waits this long for the computer's hello before it hangs up.
export const REMOTE_HELLO_TIMEOUT_MS = 10_000

// A text frame past this size is refused by either end before it is parsed.
export const REMOTE_MAX_TEXT_FRAME_BYTES = 8 * 1024 * 1024

// The token the desktop app keeps for one link, shown once and stored only as its sha256 by the hub.
export const REMOTE_COMPUTER_TOKEN_PREFIX = 'rrn_computer_'

// What one computer runs at the same time in the background, whoever asked.
export const REMOTE_MAX_JOBS = 4

export const remoteOsSchema = z.enum(['mac', 'win', 'linux'])
export type RemoteOs = z.infer<typeof remoteOsSchema>

export const REMOTE_CAPABILITIES = ['shell', 'files', 'jobs', 'screen'] as const
export const remoteCapabilitySchema = z.enum(REMOTE_CAPABILITIES)
export type RemoteCapability = z.infer<typeof remoteCapabilitySchema>

// `#studio-pc` in a message: lower case, digits and dashes, starting and ending on a letter or digit.
export const REMOTE_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/
export const remoteHandleSchema = z.string().regex(REMOTE_HANDLE_PATTERN)

// The handle a name gives: accents dropped, anything else turned into dashes. Empty when nothing is left.
export function remoteHandleFromName(name: string): string {
    return name
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32)
        .replace(/-+$/g, '')
}

// What a computer says about itself: the coworker reads it to pick the machine and write commands
// in the right shell.
export const remoteFactsSchema = z.object({
    hostname: z.string().max(255),
    os: remoteOsSchema,
    osVersion: z.string().max(100),
    arch: z.string().max(32),
    cpu: z.string().max(200).optional(),
    cores: z.number().int().nonnegative().optional(),
    memoryBytes: z.number().nonnegative().optional(),
    gpus: z.array(z.string().max(200)).max(8).optional(),
    shell: z.string().max(32),
    homeDir: z.string().max(1024),
    workDir: z.string().max(1024),
    // Programs found on the PATH among the ones a coworker most often reaches for (ffmpeg, python…).
    software: z.array(z.string().max(64)).max(64).optional(),
    screen: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
})
export type RemoteFacts = z.infer<typeof remoteFactsSchema>

// The first frame the computer sends.
export const remoteHelloSchema = z.object({
    type: z.literal('hello'),
    protocol: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }),
    app: z.object({ version: z.string().max(64) }),
    capabilities: z.array(remoteCapabilitySchema).max(REMOTE_CAPABILITIES.length),
    facts: remoteFactsSchema,
    paused: z.boolean().default(false),
})
export type RemoteHello = z.infer<typeof remoteHelloSchema>

export const remoteWelcomeSchema = z.object({ type: z.literal('welcome'), protocol: z.number().int().positive(), computerId: z.string() })
export type RemoteWelcome = z.infer<typeof remoteWelcomeSchema>

// The highest version both ends speak, null when their ranges do not meet.
export function negotiateRemoteProtocol(peer: { min: number; max: number }, own: { min: number; max: number } = { min: REMOTE_PROTOCOL_MIN, max: REMOTE_PROTOCOL_MAX }): number | null {
    const version = Math.min(peer.max, own.max)
    return version >= Math.max(peer.min, own.min) ? version : null
}

export const REMOTE_ERROR_CODES = ['paused', 'capability_off', 'outside_workdir', 'sensitive_path', 'not_found', 'too_large', 'busy', 'invalid', 'timeout', 'cancelled', 'disconnected', 'unsupported', 'internal'] as const
export const remoteErrorCodeSchema = z.enum(REMOTE_ERROR_CODES)
export type RemoteErrorCode = z.infer<typeof remoteErrorCodeSchema>

export const remoteErrorSchema = z.object({ code: remoteErrorCodeSchema.catch('internal'), message: z.string().max(4000) })
export type RemoteError = z.infer<typeof remoteErrorSchema>

export const remoteJobStateSchema = z.enum(['running', 'succeeded', 'failed', 'stopped', 'lost'])
export type RemoteJobState = z.infer<typeof remoteJobStateSchema>

export const remoteJobSchema = z.object({
    id: z.string().max(64),
    command: z.string().max(20_000),
    label: z.string().max(200).optional(),
    cwd: z.string().max(4096),
    state: remoteJobStateSchema,
    exitCode: z.number().int().nullable(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    // Who started it, as the coworker's run named them, for the activity log of the computer.
    author: z.string().max(200).optional(),
})
export type RemoteJob = z.infer<typeof remoteJobSchema>

export const remoteFileEntrySchema = z.object({
    name: z.string(),
    type: z.enum(['file', 'dir', 'link', 'other']),
    size: z.number().nonnegative(),
    modifiedAt: z.string().nullable(),
})
export type RemoteFileEntry = z.infer<typeof remoteFileEntrySchema>

const author = z.string().max(200).optional()
const path = z.string().min(1).max(4096)

// Where a file operation may land, decided by the engine from the computer's rules and the person's
// yes, checked by the computer on the real path (links followed). Null: anywhere this account can
// reach. `sensitiveOk` is the person's yes to a path where secrets live, which is refused otherwise.
const fileScope = { roots: z.array(path).max(250).nullable().default(null), sensitiveOk: z.boolean().default(false) }

// A file copied in pieces between the computer and the box, each request carrying one.
export const REMOTE_TRANSFER_CHUNK_BYTES = 1024 * 1024

export const remoteScreenActionSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('click'), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), button: z.enum(['left', 'right', 'middle']).default('left'), double: z.boolean().default(false) }),
    z.object({ action: z.literal('move'), x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
    z.object({ action: z.literal('drag'), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), toX: z.number().int().nonnegative(), toY: z.number().int().nonnegative() }),
    z.object({ action: z.literal('type'), text: z.string().min(1).max(5000) }),
    z.object({ action: z.literal('key'), keys: z.string().min(1).max(100) }),
    z.object({ action: z.literal('scroll'), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().int().min(1).max(20).default(3) }),
])
export type RemoteScreenAction = z.infer<typeof remoteScreenActionSchema>

// Every request the engine sends, its parameters and what the computer answers. A method the
// computer does not know is answered `unsupported`; the engine only calls what the capabilities offer.
export const REMOTE_METHODS = {
    info: { params: z.object({}), result: z.object({ facts: remoteFactsSchema, paused: z.boolean() }) },
    'exec.run': {
        params: z.object({ execId: z.string().max(64), command: z.string().min(1).max(20_000), cwd: path.optional(), timeoutMs: z.number().int().positive().max(600_000), author }),
        result: z.object({ exitCode: z.number().int().nullable(), stdout: z.string(), stderr: z.string(), truncated: z.boolean(), timedOut: z.boolean(), durationMs: z.number().nonnegative() }),
    },
    'exec.cancel': { params: z.object({ execId: z.string().max(64) }), result: z.object({ cancelled: z.boolean() }) },
    'job.start': {
        params: z.object({ command: z.string().min(1).max(20_000), cwd: path.optional(), label: z.string().max(200).optional(), author }),
        result: z.object({ job: remoteJobSchema }),
    },
    'job.status': { params: z.object({ jobId: z.string().max(64) }), result: z.object({ job: remoteJobSchema }) },
    'job.logs': { params: z.object({ jobId: z.string().max(64), tailBytes: z.number().int().positive().max(200_000).default(8_000) }), result: z.object({ job: remoteJobSchema, output: z.string(), truncated: z.boolean() }) },
    'job.stop': { params: z.object({ jobId: z.string().max(64) }), result: z.object({ job: remoteJobSchema }) },
    'job.list': { params: z.object({}), result: z.object({ jobs: z.array(remoteJobSchema) }) },
    'fs.list': { params: z.object({ path, author, ...fileScope }), result: z.object({ path: z.string(), entries: z.array(remoteFileEntrySchema), truncated: z.boolean() }) },
    'fs.stat': { params: z.object({ path, author, ...fileScope }), result: z.object({ path: z.string(), entry: remoteFileEntrySchema }) },
    'fs.read': {
        params: z.object({ path, maxBytes: z.number().int().positive().max(1_000_000).default(200_000), author, ...fileScope }),
        result: z.object({ path: z.string(), content: z.string(), encoding: z.enum(['utf8', 'base64']), size: z.number().nonnegative(), truncated: z.boolean() }),
    },
    'fs.write': {
        params: z.object({ path, content: z.string().max(4_000_000), encoding: z.enum(['utf8', 'base64']).default('utf8'), author, ...fileScope }),
        result: z.object({ path: z.string(), size: z.number().nonnegative() }),
    },
    // One piece of a file going to the box. The last one says so and carries the sha256 of the whole.
    'fs.pull': {
        params: z.object({ path, offset: z.number().int().nonnegative(), author, ...fileScope }),
        result: z.object({ path: z.string(), size: z.number().nonnegative(), data: z.string(), eof: z.boolean(), sha256: z.string().nullable() }),
    },
    // One piece of a file coming from the box, written to a `.part` file renamed into place once the
    // last piece matches the sha256 it carries.
    'fs.push': {
        params: z.object({ path, offset: z.number().int().nonnegative(), data: z.string().max(2 * REMOTE_TRANSFER_CHUNK_BYTES), final: z.boolean(), sha256: z.string().max(64).optional(), overwrite: z.boolean().default(false), author, ...fileScope }),
        result: z.object({ path: z.string(), size: z.number().nonnegative(), done: z.boolean() }),
    },
    'screen.capture': { params: z.object({ maxWidth: z.number().int().positive().max(4096).default(1440), author }), result: z.object({ jpegBase64: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), scale: z.number().positive() }) },
    'screen.act': { params: z.object({ action: remoteScreenActionSchema, author }), result: z.object({ done: z.boolean() }) },
} as const

export type RemoteMethod = keyof typeof REMOTE_METHODS
export type RemoteParams<M extends RemoteMethod> = z.input<(typeof REMOTE_METHODS)[M]['params']>
export type RemoteResult<M extends RemoteMethod> = z.infer<(typeof REMOTE_METHODS)[M]['result']>

export const REMOTE_METHOD_NAMES = Object.keys(REMOTE_METHODS) as RemoteMethod[]

// The capability each method needs on the computer's side.
export const REMOTE_METHOD_CAPABILITY: Record<RemoteMethod, RemoteCapability | null> = {
    info: null,
    'exec.run': 'shell',
    'exec.cancel': 'shell',
    'job.start': 'jobs',
    'job.status': 'jobs',
    'job.logs': 'jobs',
    'job.stop': 'jobs',
    'job.list': 'jobs',
    'fs.list': 'files',
    'fs.stat': 'files',
    'fs.read': 'files',
    'fs.write': 'files',
    'fs.pull': 'files',
    'fs.push': 'files',
    'screen.capture': 'screen',
    'screen.act': 'screen',
}

export const remoteRequestFrameSchema = z.object({ type: z.literal('req'), id: z.string().max(64), method: z.string().max(64), params: z.unknown() })
export type RemoteRequestFrame = z.infer<typeof remoteRequestFrameSchema>

export const remoteResponseFrameSchema = z.discriminatedUnion('ok', [
    z.object({ type: z.literal('res'), id: z.string().max(64), ok: z.literal(true), result: z.unknown() }),
    z.object({ type: z.literal('res'), id: z.string().max(64), ok: z.literal(false), error: remoteErrorSchema }),
])
export type RemoteResponseFrame = z.infer<typeof remoteResponseFrameSchema>

// What the computer tells on its own: a job ended (sent again until the engine acknowledges it), the
// person paused or resumed the computer.
export const remoteEventFrameSchema = z.discriminatedUnion('event', [
    z.object({ type: z.literal('event'), event: z.literal('job.finished'), job: remoteJobSchema }),
    z.object({ type: z.literal('event'), event: z.literal('status'), paused: z.boolean(), capabilities: z.array(remoteCapabilitySchema).max(REMOTE_CAPABILITIES.length).optional() }),
])
export type RemoteEventFrame = z.infer<typeof remoteEventFrameSchema>

export const remoteAckFrameSchema = z.object({ type: z.literal('ack'), event: z.literal('job.finished'), jobId: z.string().max(64) })
export type RemoteAckFrame = z.infer<typeof remoteAckFrameSchema>

export const remoteComputerFrameSchema = z.union([remoteHelloSchema, remoteResponseFrameSchema, remoteEventFrameSchema])
export const remoteEngineFrameSchema = z.union([remoteWelcomeSchema, remoteRequestFrameSchema, remoteAckFrameSchema])

// A text frame read off the socket: null when it is too big, not JSON, or not one of `schema`.
export function parseRemoteFrame<S extends z.ZodTypeAny>(schema: S, raw: string): z.infer<S> | null {
    if (raw.length > REMOTE_MAX_TEXT_FRAME_BYTES || new TextEncoder().encode(raw).length > REMOTE_MAX_TEXT_FRAME_BYTES) return null
    let value: unknown
    try {
        value = JSON.parse(raw)
    } catch {
        return null
    }
    const parsed = schema.safeParse(value)
    return parsed.success ? parsed.data : null
}

// How freely the coworkers use a computer. `remember` asks the first time a program or a folder is
// used and keeps the "always allow" answers; `ask` asks every time; `full` asks only for what always
// asks (sensitive paths, opaque commands are let through).
export const remoteAccessModeSchema = z.enum(['ask', 'remember', 'full'])
export type RemoteAccessMode = z.infer<typeof remoteAccessModeSchema>

export const remoteComputerSettingsSchema = z.object({
    mode: remoteAccessModeSchema.default('remember'),
    // Schedules, triggers and calls between coworkers may use it, with no one in the chat.
    unattended: z.boolean().default(true),
    allowedPrograms: z.array(z.string().min(1).max(128)).max(500).default([]),
    allowedFolders: z.array(z.string().min(1).max(4096)).max(200).default([]),
    screenAlways: z.boolean().default(false),
})
export type RemoteComputerSettings = z.infer<typeof remoteComputerSettingsSchema>

export const remoteComputerIdentitySchema = z.object({ id: z.string().min(1).max(64), handle: remoteHandleSchema, name: z.string().min(1).max(100) })
export type RemoteComputerIdentity = z.infer<typeof remoteComputerIdentitySchema>

// What the engine answers about one computer, `GET /remote/computers`.
export const remoteComputerViewSchema = remoteComputerIdentitySchema.extend({
    online: z.boolean(),
    paused: z.boolean(),
    connectedAt: z.string().nullable(),
    lastSeenAt: z.string().nullable(),
    appVersion: z.string().nullable(),
    protocol: z.number().nullable(),
    capabilities: z.array(remoteCapabilitySchema),
    facts: remoteFactsSchema.nullable(),
    settings: remoteComputerSettingsSchema,
    runningJobs: z.number().int().nonnegative().default(0),
})
export type RemoteComputerView = z.infer<typeof remoteComputerViewSchema>

export const remoteComputersListSchema = z.object({ computers: z.array(remoteComputerViewSchema) })

// What a person changes in a computer's settings, nothing else touched. No defaults here: a missing
// field is one left as it is.
export const remoteComputerSettingsPatchSchema = z.object({
    mode: remoteAccessModeSchema.optional(),
    unattended: z.boolean().optional(),
    allowedPrograms: z.array(z.string().min(1).max(128)).max(500).optional(),
    allowedFolders: z.array(z.string().min(1).max(4096)).max(200).optional(),
    screenAlways: z.boolean().optional(),
})
export type RemoteComputerSettingsPatch = z.infer<typeof remoteComputerSettingsPatchSchema>

// `PUT /remote/computers/:id`: the hub registers a computer it linked, renames it, or changes its settings.
export const remoteComputerUpsertSchema = z.object({ handle: remoteHandleSchema, name: z.string().min(1).max(100), settings: remoteComputerSettingsPatchSchema.optional() })
export type RemoteComputerUpsert = z.infer<typeof remoteComputerUpsertSchema>

// `POST /remote/computers/:id/rules`: an "always allow" answered on a card, written before the answer is sent.
export const remoteComputerRuleSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('program'), program: z.string().min(1).max(128) }),
    z.object({ kind: z.literal('folder'), folder: z.string().min(1).max(4096) }),
    z.object({ kind: z.literal('screen') }),
])
export type RemoteComputerRule = z.infer<typeof remoteComputerRuleSchema>
