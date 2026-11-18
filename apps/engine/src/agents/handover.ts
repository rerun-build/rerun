import { mkdir } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import type { ContextSize, Provider } from '@rerun/contracts'
import { handoverDir, sharedDir } from '../config/paths.js'
import { writeFileAtomic } from '../lib/atomic-write.js'

export const wantsHandover = (provider: Provider, size: ContextSize | undefined): boolean => provider === 'claude' && (size === 'medium' || size === 'large')

export const handoverPath = (agentId: string, runId: string, n: number): string => `handover/${basename(handoverDir(agentId))}/${runId}-${n}.md`

export async function saveHandover(agentId: string, runId: string, n: number, summary: string): Promise<string> {
    const path = handoverPath(agentId, runId, n)
    await mkdir(handoverDir(agentId), { recursive: true, mode: 0o700 })
    await writeFileAtomic(resolve(sharedDir(), path), summary)
    return path
}
