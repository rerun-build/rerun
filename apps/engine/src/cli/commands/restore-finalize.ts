import { prepareDataDir } from '../../datadir/ladder.js'
import { readDataVersion } from '../../datadir/version.js'
import { listAgentIdsOnDisk } from '../../agents/loader.js'
import { listSchedules, markFired } from '../../schedules/loader.js'
import { isDue } from '../../schedules/cron.js'
import { nowIso } from '../../lib/ids.js'
import { rebaseWakesAfterRestore } from '../../foreman/wake-state.js'

// Run on a data-dir just restored from an archive, before the service starts. Weeks asleep leave
// every timed schedule overdue, and the scheduler would fire them all on its first tick. Only the
// overdue ones are marked as just fired: a cron keeps its next genuine slot, a one-shot whose moment
// passed is retired, and a one-shot still ahead is left to fire. The Chief of Staff's wakes are
// rebased the same way: the ones whose moment passed are dropped, and the day starts from now.
export async function restoreFinalizeCommand(): Promise<void> {
    await prepareDataDir()
    const now = new Date()
    const rebaselined: Record<string, string[]> = {}
    for (const agentId of await listAgentIdsOnDisk()) {
        for (const schedule of await listSchedules(agentId)) {
            if (!isDue(schedule, now)) continue
            await markFired(agentId, schedule.slug, nowIso())
            ;(rebaselined[agentId] ??= []).push(schedule.slug)
        }
    }
    const wakes = await rebaseWakesAfterRestore(now)
    process.stdout.write(JSON.stringify({ dataVersion: readDataVersion(), rebaselined, wakes }) + '\n')
}
