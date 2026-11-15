export type SessionLabelInput = {
    agentId: string
    agentName: string
    sessionId: string
    runId?: string
    jobRef?: string | null
    branch?: string | null
    copyIndex?: number
}

export const LABEL_ENV_NAMES = [
    'RERUN_COWORKER',
    'RERUN_COWORKER_ID',
    'RERUN_SESSION_ID',
    'RERUN_RUN_ID',
    'RERUN_JOB',
    'RERUN_BRANCH',
    'RERUN_COPY',
] as const

const MAX_LABEL = 200

function clean(value: string | null | undefined): string {
    if (!value) return ''
    return value.replace(/[^A-Za-z0-9 _./#:@-]/g, '').slice(0, MAX_LABEL)
}

export function sessionLabels(input: SessionLabelInput): Record<string, string> {
    const raw: Array<[string, string | null | undefined]> = [
        ['RERUN_COWORKER', input.agentName],
        ['RERUN_COWORKER_ID', input.agentId],
        ['RERUN_SESSION_ID', input.sessionId],
        ['RERUN_RUN_ID', input.runId],
        ['RERUN_JOB', input.jobRef],
        ['RERUN_BRANCH', input.branch],
        ['RERUN_COPY', input.copyIndex === undefined || !Number.isFinite(input.copyIndex) ? undefined : String(input.copyIndex)],
    ]
    const out: Record<string, string> = {}
    for (const [name, value] of raw) {
        const v = clean(value)
        if (v) out[name] = v
    }
    return out
}
