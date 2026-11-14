import { execFileSync } from 'node:child_process'

export function run(command: string, args: string[], options: { cwd?: string; input?: string } = {}): void {
    process.stdout.write(`\n$ ${command} ${args.join(' ')}\n`)
    execFileSync(command, args, { stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], cwd: options.cwd, input: options.input })
}

export function hasCommand(command: string): boolean {
    try {
        execFileSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', command], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

export function canSudo(): boolean {
    try {
        execFileSync('sudo', ['-n', 'true'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
}

export const isRoot = (): boolean => process.getuid?.() === 0

export function asRoot(command: string[], input?: string): void {
    if (isRoot()) run(command[0]!, command.slice(1), { input })
    else run('sudo', ['-n', ...command], { input })
}
