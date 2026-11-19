import { clientConfigSchema, type ClientConfig } from '@moldwright/contracts'

import { api } from '@/api/client'

export async function fetchClientConfig(): Promise<ClientConfig> {
    return clientConfigSchema.parse(await api('/api/v1/client'))
}
