import { agentImageRef, agentWorkspacePathFromHref } from '@moldwright/contracts'

import { agentFileRawUrl, sharedFileRawUrl } from './raw-url'

export const AGENT_WORKSPACE_FILE_TAG = 'agent-workspace-file'
export const AGENT_WORKSPACE_FILE_PATH_ATTRIBUTE = 'path'

type MarkdownNode = {
    type?: string
    url?: string
    data?: {
        hName?: string
        hProperties?: Record<string, unknown>
        [key: string]: unknown
    }
    children?: MarkdownNode[]
}

export { agentWorkspacePathFromHref }

export function agentImageSrc(agentId: string, src: string | undefined): string | null {
    const ref = agentImageRef(src)
    if (!ref) return null
    return ref.scope === 'shared' ? sharedFileRawUrl(ref.path) : agentFileRawUrl(agentId, ref.path)
}

export function remarkAgentWorkspaceLinks(options?: { agentId?: string }) {
    const agentId = options?.agentId
    return (tree: MarkdownNode) => {
        const visit = (node: MarkdownNode) => {
            if (node.type === 'link') {
                const path = agentWorkspacePathFromHref(node.url)
                if (path) {
                    node.data = {
                        ...node.data,
                        hName: AGENT_WORKSPACE_FILE_TAG,
                        hProperties: {
                            ...node.data?.hProperties,
                            [AGENT_WORKSPACE_FILE_PATH_ATTRIBUTE]: path,
                        },
                    }
                }
            }
            if (node.type === 'image' && agentId) {
                const src = agentImageSrc(agentId, node.url)
                if (src) node.url = src
            }
            node.children?.forEach(visit)
        }

        visit(tree)
    }
}
