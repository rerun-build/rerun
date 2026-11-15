import { NextResponse } from 'next/server'
import type { Database } from '@/app/api/database.types'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribeToken'
import { EMAIL_CATEGORIES, normalizeNotificationPrefs, type EmailCategory } from '@/lib/notifications/prefs'
import { createServiceRoleClient } from '@/supabase/serviceRole'
import { selectSingle } from '@/supabase/supabase-helpers'

type UserUpdate = Database['public']['Tables']['users']['Update']

function isCategory(value: string | null): value is EmailCategory {
    return value !== null && (EMAIL_CATEGORIES as readonly string[]).includes(value)
}

export async function POST(request: Request): Promise<NextResponse> {
    const url = new URL(request.url)
    const token = url.searchParams.get('token')
    if (!token) return NextResponse.json({ ok: false }, { status: 400 })

    const target = verifyUnsubscribeToken(token)
    if (!target) return NextResponse.json({ ok: false }, { status: 400 })

    const categoryParam = url.searchParams.get('category')
    const categories: EmailCategory[] = isCategory(categoryParam) ? [categoryParam] : [...EMAIL_CATEGORIES]

    const supabase = createServiceRoleClient()
    const { data: current } = await selectSingle(supabase, 'users', ['email_notification_prefs'] as const, { id: target.userId })
    const prefs = normalizeNotificationPrefs(current?.email_notification_prefs)
    let merged = prefs
    if (target.scope === 'runs') {
        merged = { ...prefs, email: false }
    } else {
        for (const category of categories) merged.categories[category] = false
    }

    const { error } = await supabase
        .from('users')
        .update<UserUpdate>({ email_notification_prefs: merged as unknown as UserUpdate['email_notification_prefs'] })
        .eq('id', target.userId)
    if (error) return NextResponse.json({ ok: false }, { status: 500 })

    return NextResponse.json({ ok: true })
}
