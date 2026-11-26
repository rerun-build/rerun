import type { RunStarter } from '@rerun/contracts'
import type { RunTrigger } from './context.js'

// Who started a run, kept on its row for the usage dashboard. A chat with no author and no calling
// coworker came from the API: no person is behind it, so none is ever charged for it.
export function starterOf(trigger: RunTrigger): RunStarter {
    switch (trigger.source) {
        case 'chat':
            if (trigger.calledBy) return { kind: 'coworker', id: trigger.calledBy.id }
            if (trigger.author) return { kind: 'person', id: trigger.author.id }
            return { kind: 'api', id: null }
        case 'schedule':
            return { kind: 'schedule', id: trigger.slug }
        case 'trigger':
            return { kind: 'webhook', id: trigger.slug }
        case 'checkin':
            return { kind: 'checkin', id: trigger.slug }
        case 'job':
            return { kind: 'job', id: trigger.computer }
    }
}
