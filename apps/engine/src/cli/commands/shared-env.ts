import { spawnSync } from 'node:child_process'
import { prepareDataDir } from '../../datadir/ladder.js'
import { listAgentIdsOnDisk } from '../../agents/loader.js'
import { readAgentEnv } from '../../agents/env.js'
import { readSharedEnvSync, writeSharedEnv } from '../../agents/shared-env.js'
import { sharedProcessEnv } from '../../agents/process-env.js'
import { childProcessEnv } from '../../lib/child-env.js'
import { readStdinLine } from './redact.js'

const USAGE = 'Usage: rerun shared-env list | set <NAME> (value from stdin) | remove <NAME> | run <command> [args...]'
const NAME = /^[A-Z][A-Z0-9_]*$/

function nameArgument(args: string[]): string {
    const [name, ...extra] = args
    if (!name || extra.length > 0 || !NAME.test(name)) throw new Error(USAGE)
    return name
}

async function listCommand(args: string[]): Promise<void> {
    if (args.length > 0) throw new Error(USAGE)
    const shared = readSharedEnvSync()
    const names = Object.keys(shared).sort()
    if (names.length === 0) {
        process.stdout.write('No shared variables.\n')
        return
    }
    const owners = new Map<string, string[]>()
    for (const id of (await listAgentIdsOnDisk()).sort()) {
        const own = await readAgentEnv(id)
        for (const name of names) if (name in own) owners.set(name, [...(owners.get(name) ?? []), id])
    }
    const lines = names.map(name => {
        const ids = owners.get(name)
        return ids ? `${name} (own value in: ${ids.join(', ')})` : name
    })
    process.stdout.write(`${lines.join('\n')}\n`)
}

async function setCommand(args: string[], readValue: () => Promise<string>): Promise<void> {
    const name = nameArgument(args)
    const value = (await readValue()).trim()
    if (!value) throw new Error('No value on stdin; nothing changed.')
    await writeSharedEnv({ ...readSharedEnvSync(), [name]: value })
    process.stdout.write(`Set ${name} for every coworker.\n`)
}

async function removeCommand(args: string[]): Promise<void> {
    const name = nameArgument(args)
    const shared = readSharedEnvSync()
    if (!(name in shared)) {
        process.stdout.write(`${name} was not set; nothing changed.\n`)
        return
    }
    const rest = { ...shared }
    delete rest[name]
    await writeSharedEnv(rest)
    process.stdout.write(`Removed ${name}.\n`)
}

function runCommand(args: string[]): void {
    const [command, ...rest] = args
    if (!command) throw new Error(USAGE)
    const result = spawnSync(command, rest, { stdio: 'inherit', env: childProcessEnv(sharedProcessEnv()) })
    if (result.error) throw new Error(`Cannot run ${command}: ${(result.error as NodeJS.ErrnoException).code}`)
    process.exitCode = result.status ?? 1
}

export async function sharedEnvCommand(args: string[], readValue: () => Promise<string> = readStdinLine): Promise<void> {
    await prepareDataDir()
    const [sub, ...rest] = args
    switch (sub) {
        case 'list':
            return listCommand(rest)
        case 'set':
            return setCommand(rest, readValue)
        case 'remove':
            return removeCommand(rest)
        case 'run':
            return runCommand(rest)
        default:
            throw new Error(USAGE)
    }
}
