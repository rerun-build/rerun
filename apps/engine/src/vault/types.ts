import type { VaultItemConfig } from '@rerun/contracts'

// The secrets live in `env`, never in `config`: nothing that reaches the API carries them.
export type LoadedVaultItem = {
    id: string
    config: VaultItemConfig
    env: Record<string, string>
}
