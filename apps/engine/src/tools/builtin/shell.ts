import { exec, type ExecOptions } from 'node:child_process'
import { promisify } from 'node:util'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { assertCommandAllowed } from '../sandbox.js'
import { agentProcessEnv } from '../../agents/process-env.js'
import { childProcessEnv } from '../../lib/child-env.js'
import { HostBreaker, hostsOf, httpFailureInOutput, withHostBreaker, type HostAttempt } from '../host-breaker.js'
import type { RunContext } from '../../runtime/context.js'

export type ShellRunner = (command: string, options: ExecOptions) => Promise<{ stdout: string; stderr: string }>

const execAsync = promisify(exec) as unknown as ShellRunner

type ShellError = { stdout?: string; stderr?: string; message: string; killed?: boolean; signal?: string }

export function shellTools(ctx: RunContext, run: ShellRunner = execAsync): ToolSet {
    const { cwd, env: agentEnv } = agentProcessEnv(ctx.agent)
    const env = childProcessEnv(agentEnv)
    const breaker = ctx.hostBreaker ?? new HostBreaker()
    return {
        shell_exec: tool({
            description: 'Run a shell command inside the coworker workspace, which is the working directory (pwd) and whose absolute path is in the RERUN_WORKSPACE environment variable. Use this to inspect your workspace, run scripts, and install tools you need. Your files live here, not under install paths like /opt/rerun.',
            inputSchema: z.object({
                command: z.string().describe('The shell command to execute'),
                timeoutMs: z.number().int().positive().max(600_000).default(120_000),
            }),
            execute: async ({ command, timeoutMs }) => {
                assertCommandAllowed(command)
                return withHostBreaker(breaker, hostsOf(command), async (): Promise<HostAttempt> => {
                    try {
                        const { stdout, stderr } = await run(command, { cwd, env, timeout: timeoutMs, maxBuffer: 10_000_000, signal: ctx.abortSignal })
                        const text = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`.slice(0, 50_000) || '(no output)'
                        return { text, failed: httpFailureInOutput(`${stdout}\n${stderr}`) }
                    } catch (e) {
                        if (ctx.abortSignal?.aborted) throw e
                        const err = e as ShellError
                        const timedOut = err.killed === true && err.signal === 'SIGTERM'
                        const head = timedOut ? `Command timed out after ${Math.round(timeoutMs / 1000)} s and was killed` : `Command failed: ${err.message}`
                        return { text: `${head}\n${err.stdout ?? ''}\n${err.stderr ?? ''}`.slice(0, 50_000), failed: true }
                    }
                })
            },
        }),
    }
}
