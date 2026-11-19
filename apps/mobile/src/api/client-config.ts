import { mobileApi, type ClientConfig } from '@rerun/contracts'

import { hub } from '@/api/client'

export async function fetchClientConfig(): Promise<ClientConfig> {
    return hub(mobileApi.getClientConfig, {})
}
