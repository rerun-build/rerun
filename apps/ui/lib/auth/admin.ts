import { isAdminEmail } from '@/lib/auth/admin-emails'
import { createClient } from '@/supabase/server'
import { readSettledUser } from '@/lib/auth/two-step/gate'

// Returns the authenticated admin's email, or null if the current session is not an admin.
export async function getAdminEmail(): Promise<string | null> {
    const user = await readSettledUser(await createClient())
    const email = user?.email
    if (!isAdminEmail(email)) return null
    return email!
}

// Throws if the current session is not an admin. Call first in every admin server action.
export async function assertAdminUser(): Promise<void> {
    const email = await getAdminEmail()
    if (!email) throw new Error('Unauthorized')
}

// Same check, but hands back the admin's user id for the rows that record who reviewed what.
export async function requireAdminUserId(): Promise<string> {
    const user = await readSettledUser(await createClient())
    if (!user || !isAdminEmail(user.email)) throw new Error('Unauthorized')
    return user.id
}
