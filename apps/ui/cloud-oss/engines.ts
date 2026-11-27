import 'server-only'

import type { MachineReading } from '@rerun/contracts'
import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'

export type ClaimedInstance = { id: string; engineHost: string; engineApiKey: string | null }

export type EngineClaim = { ok: true; instance: ClaimedInstance } | { ok: false; error: string; raced: boolean }

const NO_SERVER = 'This workspace has no server yet. Add one from Servers, in the workspace menu.'

const UNIQUE_VIOLATION = '23505'

// There is no pool of machines here. The engine started next to the app by docker compose
// (RERUN_ENGINE_URL and RERUN_ENGINE_API_KEY) goes to the first workspace that needs one; every
// other workspace gets its engine by pairing a server from Servers, in the workspace menu.
export async function claimPoolEngine(workspaceId: number): Promise<EngineClaim> {
    const engineHost = process.env.RERUN_ENGINE_URL?.trim()
    const engineApiKey = process.env.RERUN_ENGINE_API_KEY?.trim()
    if (!engineHost || !engineApiKey) return { ok: false, raced: false, error: NO_SERVER }

    const supabase = createServiceRoleClient()
    const { data: taken } = await selectMaybeSingle(supabase, 'engine_pool', ['id'] as const, { engine_api_key: engineApiKey })
    if (taken) return { ok: false, raced: false, error: NO_SERVER }

    const { data, error } = await supabase
        .from('engine_pool')
        .insert<Database['public']['Tables']['engine_pool']['Insert']>({ provider: 'incus', provider_server_id: null, engine_host: engineHost, engine_api_key: engineApiKey, status: 'claimed', claimed_by_workspace_id: workspaceId })
        .select('id')
        .single()
    if (error?.code === UNIQUE_VIOLATION) return { ok: false, raced: true, error: NO_SERVER }
    if (error || !data) return { ok: false, raced: false, error: error?.message ?? NO_SERVER }
    return { ok: true, instance: { id: data.id, engineHost, engineApiKey } }
}

// The engine started by docker compose answers the app on its network name (http://engine:3000),
// which no browser can open: its screen is reached on RERUN_ENGINE_BROWSER_URL instead.
export async function desktopRelayBase(engineBaseUrl: string, _hostId: string | null, _boxIndex: number | null): Promise<string | null> {
    const composeEngine = process.env.RERUN_ENGINE_URL?.trim().replace(/\/$/, '')
    const browserUrl = process.env.RERUN_ENGINE_BROWSER_URL?.trim().replace(/\/$/, '')
    if (!composeEngine || !browserUrl || engineBaseUrl.replace(/\/$/, '') !== composeEngine) return null
    return browserUrl.replace(/^http/, 'ws')
}

// The browser reaches the engine's screen on the engine itself, over the same address as the hub.
export const DESKTOP_DIRECT = true

// A self-hosted server is never archived for an unpaid plan, so a paid one has nothing to restore.
export async function requestBoxRestore(_workspaceId: number): Promise<void> {}

export async function restartManagedEngine(_instanceId: string): Promise<void> {
    throw new Error('Restart this server from the machine it runs on.')
}

// No pool to run out of: a workspace without an engine is asked to pair one, never put on a list.
export async function poolHasRoom(): Promise<boolean> {
    return true
}

// A self-hosted server is the size of the machine it runs on: nothing here is sold in sizes.
export async function readMachine(_workspaceId: number): Promise<MachineReading | null> {
    return null
}

export async function applyMachineSize(_workspaceId: number): Promise<void> {}
