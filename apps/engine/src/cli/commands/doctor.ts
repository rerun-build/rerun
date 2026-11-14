import { existsSync } from 'node:fs'
import { raw } from '../../db/client.js'
import { dataDir, dbPath } from '../../config/paths.js'
import { env } from '../../config/env.js'
import { embedBaseUrl } from '../../memory/embed.js'
import { runDataDirChecks } from '../../datadir/checks.js'

export async function doctorCommand(): Promise<void> {
    const lines: string[] = []
    lines.push(`data dir: ${dataDir()} ${existsSync(dataDir()) ? 'ok' : 'missing'}`)
    lines.push(`api key: ${env().RERUN_API_KEY ? 'set' : 'open (no auth)'}`)
    const embedBase = embedBaseUrl()
    lines.push(`embed: ${embedBase && env().RERUN_API_KEY ? `via UI (${embedBase})` : 'unset (memory recall falls back to FTS only)'}`)

    const report = await runDataDirChecks()
    for (const check of report.checks) lines.push(`${check.ok ? 'ok  ' : 'FAIL'} ${check.name}${check.detail ? `: ${check.detail}` : ''}`)

    if (existsSync(dbPath())) {
        let vector = 'no'
        try {
            await raw().execute("SELECT vector32('[1,2,3]')")
            vector = 'yes'
        } catch {
            vector = 'no'
        }
        lines.push(`vector support: ${vector}`)
    }

    process.stdout.write(lines.join('\n') + '\n')
    if (!report.ok) process.exitCode = 1
}
