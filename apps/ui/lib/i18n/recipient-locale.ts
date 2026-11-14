import type { Database } from '@/app/api/database.types'
import { I18N_RELEASED } from '@/lib/features'
import { selectMaybeSingle } from '@/supabase/supabase-helpers'
import { DEFAULT_LOCALE, isStableLocale, type Locale } from '@rerun/i18n'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function recipientLocale(supabase: SupabaseClient<Database>, userId: string, workspaceId: number | null): Promise<Locale> {
    const { data: user } = await selectMaybeSingle(supabase, 'users', ['locale'] as const, { id: userId })
    if (isStableLocale(user?.locale)) return user.locale
    return workspaceId === null ? DEFAULT_LOCALE : workspaceLocale(supabase, workspaceId)
}

export async function workspaceLocale(supabase: SupabaseClient<Database>, workspaceId: number): Promise<Locale> {
    if (!I18N_RELEASED) return DEFAULT_LOCALE
    const { data: workspace } = await selectMaybeSingle(supabase, 'workspaces', ['locale'] as const, { id: workspaceId })
    return isStableLocale(workspace?.locale) ? workspace.locale : DEFAULT_LOCALE
}
