import { isAdminEmail } from '@/lib/auth/admin-emails'
import { createClient } from '@/supabase/server'

export async function getAdminEmail(): Promise<string | null> {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    const email = data.user?.email
    if (!isAdminEmail(email)) return null
    return email!
}

export async function assertAdminUser(): Promise<void> {
    const email = await getAdminEmail()
    if (!email) throw new Error('Unauthorized')
}

export async function requireAdminUserId(): Promise<string> {
    const supabase = await createClient()
    const { data } = await supabase.auth.getUser()
    if (!isAdminEmail(data.user?.email)) throw new Error('Unauthorized')
    return data.user!.id
}
