import { describe, expect, it } from 'vitest'

import { subRunProgressOf } from '@/lib/chat/sub-run-progress'
import { beginSubRun, endSubRun, snapshotSubRun, type SubRunProgress } from './sub-run-watch'

const progressOf = (): SubRunProgress => ({ title: 'Scout', status: 'queued', steps: 0 })

describe('snapshotSubRun', () => {
    it('hands the block a task it reads back whole, idle time included', () => {
        const progress = progressOf()
        beginSubRun(progress)
        progress.lastActivityAt = Date.now() - 65_000
        progress.steps = 3

        const running = snapshotSubRun(progress)
        expect(running).not.toHaveProperty('lastActivityAt')
        expect(running.idleMs).toBeGreaterThanOrEqual(65_000)
        expect(subRunProgressOf({ type: 'data-delegate', id: 'call-1', data: { tasks: [running] } })).toEqual({ kind: 'delegate', tasks: [running] })

        endSubRun(progress)
        expect(snapshotSubRun(progress)).not.toHaveProperty('idleMs')
    })
})
