import type { Database } from '@/app/api/database.types'
import { ApiError, apiRoute } from '@/app/api/v1/_lib/api-route'
import { refusal } from '@/lib/i18n/action-error'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { mobileApi } from '@rerun/contracts'

type DeviceTokenInsert = Database['public']['Tables']['device_tokens']['Insert']
type DeviceTokenUpdate = Database['public']['Tables']['device_tokens']['Update']

const HOLDER_COLUMNS = ['user_id', 'revoked_at', 'last_seen_at'] as const
// A phone that signed out hands its token over at once; one that merely went quiet, after this long.
const QUIET_DEVICE_MS = 30 * 24 * 60 * 60_000

export const dynamic = 'force-dynamic'

// Registered on every launch: Expo can rotate the token, and `last_seen_at` tells a quiet device from
// a gone one. The token is unique across users: the same phone signing in as someone else moves to
// that account rather than keep ringing for the previous one, once that account signed out or went
// quiet. A token another account still uses stays theirs: a leaked token must not move their pushes.
// Clearing `revoked_at` covers a reinstall handing back a token Expo had reported dead.
export const POST = apiRoute(mobileApi.registerDevice, { auth: 'user' }, async ({ ctx, body }) => {
    const supabase = createServiceRoleClient()
    const { data: holder, error: readError } = await selectMaybeSingle(supabase, 'device_tokens', HOLDER_COLUMNS, { token: body.token })
    if (readError) throw new Error(`Failed to read the device: ${readError.message}`)
    const stillTheirs = holder && holder.user_id !== ctx.user.id && holder.revoked_at === null && Date.parse(holder.last_seen_at) > Date.now() - QUIET_DEVICE_MS
    if (stillTheirs) throw new ApiError(409, refusal('deviceOtherAccount'))

    const { error } = await supabase
        .from('device_tokens')
        .upsert<DeviceTokenInsert>({ user_id: ctx.user.id, token: body.token, platform: body.platform, app_version: body.appVersion ?? null, last_seen_at: new Date().toISOString(), revoked_at: null }, { onConflict: 'token' })
    if (error) throw new Error(`Failed to register the device: ${error.message}`)
})

// Sign-out. Revoked rather than deleted, so the token coming back after a reinstall is the same device.
export const DELETE = apiRoute(mobileApi.unregisterDevice, { auth: 'user' }, async ({ ctx, body }) => {
    const { error } = await createServiceRoleClient().from('device_tokens').update<DeviceTokenUpdate>({ revoked_at: new Date().toISOString() }).eq('token', body.token).eq('user_id', ctx.user.id)
    if (error) throw new Error(`Failed to revoke the device: ${error.message}`)
})
