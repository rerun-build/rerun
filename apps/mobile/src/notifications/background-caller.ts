import { storedWorkspaceId } from '@/auth/AuthProvider'
import { supabase } from '@/auth/supabase'

export type BackgroundCaller = { accessToken: string; workspaceId: number }

// Who the app calls the hub as when a push woke it, with no screen up: the stored session, refreshed
// if it expired, in the push's workspace or the one this phone last picked.
export async function backgroundCaller(workspaceId: number | undefined): Promise<BackgroundCaller | null> {
    const [{ data }, picked] = await Promise.all([supabase.auth.getSession(), workspaceId ?? storedWorkspaceId()])
    return data.session && picked !== null ? { accessToken: data.session.access_token, workspaceId: picked } : null
}
