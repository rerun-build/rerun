import type { AgentArchivePlan } from '@rerun/contracts'
import { fetchAgentArchive, planAgentArchive } from '@/lib/engine/client'
import type { EngineConnection } from '@/lib/engine/types'
import { AppError } from '@/lib/i18n/action-error'

export const staleExportError = () => new AppError('staleEngineExport')
export const staleImportError = () => new AppError('staleEngineImport')

export function isMissingRoute(err: unknown): boolean {
    return err instanceof Error && /failed: 404/.test(err.message)
}

export type CapturedArchive = { plan: AgentArchivePlan; bytes: Uint8Array }

export async function captureAgentArchive(conn: EngineConnection, engineAgentId: string, exclude: string[]): Promise<CapturedArchive> {
    let plan: AgentArchivePlan
    try {
        plan = await planAgentArchive(conn, engineAgentId, exclude)
    } catch (err) {
        throw isMissingRoute(err) ? staleExportError() : err
    }

    const response = await fetchAgentArchive(conn, engineAgentId, exclude)
    if (!response.ok) throw new Error(`Failed to export "${plan.name}": ${response.status} ${await response.text().catch(() => '')}`)

    return { plan, bytes: new Uint8Array(await response.arrayBuffer()) }
}

export function archiveWarnings(plan: AgentArchivePlan, label: string): string[] {
    const warnings: string[] = []
    if (plan.strippedConfigKeys.length > 0) {
        warnings.push(`"${label}": ${plan.strippedConfigKeys.length} literal credential(s) were stripped from config.json (${plan.strippedConfigKeys.join(', ')}).`)
    }
    if (plan.triggers.length > 0) {
        warnings.push(`"${label}": ${plan.triggers.length} webhook(s) travel, each issued its own URL on install (${plan.triggers.map(trigger => trigger.name).join(', ')}). Whoever installs this has to point their service at the new address.`)
    }
    return warnings
}
