import type { Database } from '@/app/api/database.types'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { deviceTokenSchema } from '@rerun/contracts'

type DeviceTokenInsert = Database['public']['Tables']['device_tokens']['Insert']
type DeviceTokenUpdate = Database['public']['Tables']['device_tokens']['Update']

const HOLDER_COLUMNS = ['user_id', 'revoked_at', 'last_seen_at'] as const
const QUIET_DEVICE_MS = 30 * 24 * 60 * 60_000

export const dynamic = 'force-dynamic'

export const POST = apiRoute({ auth: 'user', body: deviceTokenSchema }, async ({ ctx, body }) => {
    const supabase = createServiceRoleClient()
    const { data: holder, error: readError } = await selectMaybeSingle(supabase, 'device_tokens', HOLDER_COLUMNS, { token: body.token })
    if (readError) throw new Error(`Failed to read the device: ${readError.message}`)
    const stillTheirs = holder && holder.user_id !== ctx.user.id && holder.revoked_at === null && Date.parse(holder.last_seen_at) > Date.now() - QUIET_DEVICE_MS
    if (stillTheirs) throw new ApiError(409, 'This device is registered to another account.')

    const { error } = await supabase
        .from('device_tokens')
        .upsert<DeviceTokenInsert>({ user_id: ctx.user.id, token: body.token, platform: body.platform, app_version: body.appVersion ?? null, last_seen_at: new Date().toISOString(), revoked_at: null }, { onConflict: 'token' })
    if (error) throw new Error(`Failed to register the device: ${error.message}`)
})

export const DELETE = apiRoute({ auth: 'user', body: deviceTokenSchema }, async ({ ctx, body }) => {
    const { error } = await createServiceRoleClient().from('device_tokens').update<DeviceTokenUpdate>({ revoked_at: new Date().toISOString() }).eq('token', body.token).eq('user_id', ctx.user.id)
    if (error) throw new Error(`Failed to revoke the device: ${error.message}`)
})
