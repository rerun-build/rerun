import type { Database } from '@/app/api/database.types'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { CLIENT_HEADER, parseClientHeader } from '@rerun/contracts'

type BuildDayInsert = Database['public']['Tables']['app_build_days']['Insert']

// What this process already wrote today: a person opening the app twenty times a day is one write.
// Bounded, so a long-lived process does not keep every day it saw.
const written = new Set<string>()
const MAX_REMEMBERED = 50_000

// The build of the app behind a signed-in call, counted once per person and day for the back office:
// a build is retired only once nobody runs it. Never in the way of the answer: the write is not
// awaited, and a failure costs a line in the log and a second try on the next call.
export function recordBuildDay(req: Request, userId: string, now = new Date()): void {
    const client = parseClientHeader(req.headers.get(CLIENT_HEADER))
    if (!client) return
    const row: BuildDayInsert = { day: now.toISOString().slice(0, 10), platform: client.platform, build: client.build, version: client.version.slice(0, 32), user_id: userId }
    const key = `${row.day}:${row.platform}:${row.build}:${userId}`
    if (written.has(key)) return
    if (written.size >= MAX_REMEMBERED) written.clear()
    written.add(key)
    const forget = (reason: unknown) => {
        written.delete(key)
        console.warn('[api/v1] could not count the build of the app', reason)
    }
    try {
        createServiceRoleClient()
            .from('app_build_days')
            .upsert<BuildDayInsert>(row, { onConflict: 'day,platform,build,user_id', ignoreDuplicates: true })
            .then(({ error }) => error && forget(error.message), forget)
    } catch (err) {
        forget(err)
    }
}
