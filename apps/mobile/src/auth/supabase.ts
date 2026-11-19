import type { Database } from '@moldwright/db/types'
import { createClient } from '@supabase/supabase-js'
import { AppState } from 'react-native'

import { AUTH_FLOW_TYPE } from '@/auth/auth-flow'
import { secureStorage } from '@/auth/secure-storage'
import { environment } from '@/config/environment'

export const supabase = createClient<Database>(environment.supabaseUrl, environment.supabasePublishableKey, {
    auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, flowType: AUTH_FLOW_TYPE },
})

AppState.addEventListener('change', state => {
    if (state === 'active') supabase.auth.startAutoRefresh()
    else supabase.auth.stopAutoRefresh()
})
