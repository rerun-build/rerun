import { queue } from '@trigger.dev/sdk/v3'

export const expertScrapeQueue = queue({ name: 'import-expert', concurrencyLimit: 3 })
