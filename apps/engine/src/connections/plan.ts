import { existsSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { boxPlanSchema, trialModelFor, type BoxPlan, type Provider } from '@moldwright/contracts'
import { boxPlanPath } from '../config/paths.js'
import { clearAgentCache } from '../agents/registry.js'

const UNRESTRICTED: BoxPlan = { premiumModels: true }

let cached: BoxPlan | undefined

export function readBoxPlan(): BoxPlan {
    if (cached) return cached
    const path = boxPlanPath()
    try {
        cached = existsSync(path) ? boxPlanSchema.parse(JSON.parse(readFileSync(path, 'utf8'))) : UNRESTRICTED
    } catch {
        cached = UNRESTRICTED
    }
    return cached
}

export async function writeBoxPlan(next: BoxPlan): Promise<BoxPlan> {
    const target = boxPlanPath()
    const tmp = `${target}.tmp`
    await writeFile(tmp, `${JSON.stringify(next, null, 4)}\n`, 'utf8')
    await rename(tmp, target)
    cached = next
    clearAgentCache()
    return next
}

export function allowedModel(provider: Provider, model: string): string {
    return readBoxPlan().premiumModels ? model : trialModelFor(provider, model)
}
