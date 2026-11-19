import type { RewindPayload } from '@moldwright/contracts'

export type RewindSlideProps = {
    payload: RewindPayload
    agentName: (agentId: string) => string
    onReplay: () => void
    onClose: () => void
    wide: boolean
}
