import * as SecureStore from 'expo-secure-store'

const CHUNK_SIZE = 1800
const KEYCHAIN = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }

function chunkKey(key: string, index: number): string {
    return `${key}.${index}`
}

async function readCount(key: string): Promise<number> {
    const raw = await SecureStore.getItemAsync(key)
    const count = raw === null ? 0 : Number.parseInt(raw, 10)
    return Number.isFinite(count) && count > 0 ? count : 0
}

export const secureStorage = {
    async getItem(key: string): Promise<string | null> {
        const count = await readCount(key)
        if (count === 0) return null

        const chunks = await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))))
        return chunks.some(chunk => chunk === null) ? null : chunks.join('')
    },

    async setItem(key: string, value: string): Promise<void> {
        const chunks = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'g')) ?? ['']
        await this.removeItem(key)
        await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(key, index), chunk, KEYCHAIN)))
        await SecureStore.setItemAsync(key, String(chunks.length), KEYCHAIN)
    },

    async removeItem(key: string): Promise<void> {
        const count = await readCount(key)
        await Promise.all(Array.from({ length: count }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index))))
        await SecureStore.deleteItemAsync(key)
    },
}
