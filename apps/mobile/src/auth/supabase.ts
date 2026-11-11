import type { Database } from '@rerun/db/types'
import { createClient } from '@supabase/supabase-js'
import { AppState } from 'react-native'

import { AUTH_FLOW_TYPE } from '@/auth/auth-flow'
import { secureStorage } from '@/auth/secure-storage'
import { environment } from '@/config/environment'

export const supabase = createClient<Database>(environment.supabaseUrl, environment.supabasePublishableKey, {
    auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: AUTH_FLOW_TYPE },
})

// The refresh timer does not run while iOS holds the app in the background, so a token can expire
// there: the refresh restarts, and catches up, as soon as the app is in front again.
AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh()
    else supabase.auth.stopAutoRefresh()
})
