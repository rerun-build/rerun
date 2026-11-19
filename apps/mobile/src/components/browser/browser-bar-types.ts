import type { ReactNode } from 'react'

export type BrowserBarProps = {
    host: string
    labels: { close: string; reload: string; pageActions: string }
    onClose: () => void
    onReload: () => void
    // The MenuItem rows the host's pill opens.
    children: ReactNode
}
