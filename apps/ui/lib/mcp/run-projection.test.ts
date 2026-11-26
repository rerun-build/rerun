import { describe, expect, it } from 'vitest'

import { projectRun } from './run-projection'

const RUN = { id: 'r1', status: 'error', sessionId: '', provider: null, model: null, triggerSource: 'schedule', triggerSlug: 'sync-prices', stepCount: 0, inputTokens: null, outputTokens: null, totalTokens: null, costMicros: null, startedAt: '2026-11-26T08:00:00.000Z', finishedAt: '2026-11-26T08:00:04.000Z', error: 'exit code 2: boom' }

describe('projectRun', () => {
    it('carries the exit code of a script run', () => {
        expect(projectRun({ ...RUN, exitCode: 2 })).toMatchObject({ runId: 'r1', trigger: 'schedule:sync-prices', error: 'exit code 2: boom', exitCode: 2 })
    })

    it('says null for a run that has none, from an engine that sends it or not', () => {
        expect(projectRun({ ...RUN, exitCode: null }).exitCode).toBeNull()
        expect(projectRun(RUN).exitCode).toBeNull()
    })
})
