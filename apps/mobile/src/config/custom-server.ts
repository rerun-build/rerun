import { clientServerSchema, type ClientServer } from '@moldwright/contracts'
import { reloadAppAsync } from 'expo'
import * as SecureStore from 'expo-secure-store'

const CUSTOM_SERVER_KEY = 'rerun.server'

const customServerSchema = clientServerSchema.extend({ apiUrl: clientServerSchema.shape.supabaseUrl })
export type CustomServer = ClientServer & { apiUrl: string }

export function readCustomServer(): CustomServer | null {
    const raw = SecureStore.getItem(CUSTOM_SERVER_KEY)
    if (!raw) return null
    try {
        const parsed = customServerSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
    } catch {
        return null
    }
}

export async function switchServer(server: CustomServer | null): Promise<void> {
    if (server) await SecureStore.setItemAsync(CUSTOM_SERVER_KEY, JSON.stringify(server))
    else await SecureStore.deleteItemAsync(CUSTOM_SERVER_KEY)
    await reloadAppAsync('server changed')
}
