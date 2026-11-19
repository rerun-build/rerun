export { parseInstallMessage, type InstallMessage } from '@moldwright/contracts'

const CLOSING_TAG = '</agent_install>'
const ESCAPED_CLOSING_TAG = '<\\/agent_install>'

export function buildInstallMessage(guide: string, agentName: string): string {
    const name = agentName.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    return `<agent_install agent="${name}">\n${guide.trim().replaceAll(CLOSING_TAG, ESCAPED_CLOSING_TAG)}\n${CLOSING_TAG}`
}

export function installSessionTitle(agentName: string): string {
    return `Install ${agentName}`
}
