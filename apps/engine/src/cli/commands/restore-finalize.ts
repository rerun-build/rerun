import { prepareDataDir } from '../../datadir/ladder.js'
import { readDataVersion } from '../../datadir/version.js'
import { listAgentIdsOnDisk } from '../../agents/loader.js'
import { listSchedules, markFired } from '../../schedules/loader.js'
import { isDue } from '../../schedules/cron.js'
import { nowIso } from '../../lib/ids.js'

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
    process.stdout.write(JSON.stringify({ dataVersion: readDataVersion(), rebaselined }) + '\n')
}
