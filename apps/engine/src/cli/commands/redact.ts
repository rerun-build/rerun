import { createHash } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prepareDataDir } from '../../datadir/ladder.js'
import { agentExists } from '../../agents/loader.js'
import { redactValue } from '../../db/repos/redact.js'
import { dataDir } from '../../config/paths.js'
import { nowIso } from '../../lib/ids.js'

async function readStdinLine(): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8').split('\n')[0].replace(/\r$/, '')
}

export async function redactCommand(args: string[], readValue: () => Promise<string> = readStdinLine): Promise<void> {
    await prepareDataDir()
    const id = args[0]
    if (!id || !agentExists(id)) throw new Error('Usage: rerun redact <agentId>  (the value is read from stdin)')
    const value = await readValue()
    const c = await redactValue(id, value)
    const hash = createHash('sha256').update(value).digest('hex').slice(0, 12)
    await appendFile(
        resolve(dataDir(), 'redactions.log'),
        `${nowIso()} agent=${id} sha256=${hash} messages=${c.messages} searchRows=${c.searchRows} toolCalls=${c.toolCalls} runs=${c.runs} checkpoints=${c.checkpoints}\n`,
        { mode: 0o600 },
    )
    process.stdout.write(`Redacted from ${id}: messages ${c.messages}, search rows ${c.searchRows}, tool calls ${c.toolCalls}, runs ${c.runs}, checkpoints ${c.checkpoints}\n`)
}
