import { getSpaceConnection } from '../app/api/_services/space.service'
import { deleteAgent as engineDeleteAgent, getAgent as engineGetAgent, listSkills, listTriggers } from '../lib/engine/client'
import { installTemplate } from '../lib/templates/install'
import { workspaceActor } from '../app/api/_auth/access'
import { createServiceRoleClient } from '../supabase/serviceRole'
import { selectMany } from '@moldwright/db/helpers'

const SLUG = process.env.VERIFY_TEMPLATE_SLUG ?? 'dfs'
const SPACE_ID = process.env.VERIFY_SPACE_ID ?? '644a7ff0-ba92-4830-aadf-a2465eb8ed3e'
const WORKSPACE_ID = Number(process.env.VERIFY_WORKSPACE_ID ?? 13)

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail?: string) {
    if (ok) {
        passed++
        console.log(`  ok    ${label}`)
    } else {
        failed++
        console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
    }
}

const supabase = createServiceRoleClient()

async function agentsInSpace() {
    const { data } = await selectMany(supabase, 'agents', ['id', 'name', 'handle', 'engine_agent_id', 'col', 'row'] as const, { space_id: SPACE_ID })
    return data ?? []
}

const before = new Set((await agentsInSpace()).map(a => a.id))
const created: { id: string; engineAgentId: string | null }[] = []

try {
    console.log(`\ninstallTemplate("${SLUG}") — first pass`)
    const first = await installTemplate(supabase, SLUG, { workspaceId: WORKSPACE_ID, spaceId: SPACE_ID, actor: workspaceActor(WORKSPACE_ID) })
    check('every agent imported', first.failed.length === 0, JSON.stringify(first.failed))
    check('at least one agent imported', first.imported > 0)

    console.log(`\ninstallTemplate("${SLUG}") — second pass, same space`)
    const second = await installTemplate(supabase, SLUG, { workspaceId: WORKSPACE_ID, spaceId: SPACE_ID, actor: workspaceActor(WORKSPACE_ID) })
    check('every agent imported again', second.failed.length === 0, JSON.stringify(second.failed))

    const after = (await agentsInSpace()).filter(a => !before.has(a.id))
    created.push(...after.map(a => ({ id: a.id, engineAgentId: a.engine_agent_id })))

    check('both passes produced rows', after.length === first.imported + second.imported, `${after.length} rows for ${first.imported + second.imported} imports`)
    check('handles are unique in the space', new Set(after.map(a => a.handle)).size === after.length, after.map(a => a.handle).join(', '))
    check('the second pass suffixed its handles', after.some(a => /_\d+$/.test(a.handle ?? '')), after.map(a => a.handle).join(', '))
    check('every agent is placed on the grid', after.every(a => a.col >= 0 && a.row >= 0))

    const conn = await getSpaceConnection(SPACE_ID)
    const triggerTokens: string[] = []
    for (const agent of after) {
        if (!agent.engine_agent_id) continue
        const detail = await engineGetAgent(conn, agent.engine_agent_id)
        check(`engine folder for "${agent.name}" carries the handle`, detail.config.name === agent.handle, `${detail.config.name} vs ${agent.handle}`)
        check(`engine folder for "${agent.name}" carries a soul`, detail.soul.trim().length > 0)
        check(`engine folder for "${agent.name}" carries no source agent id`, !JSON.stringify(detail.config.mcpServers).includes('${agent.id}'))
        const skills = await listSkills(conn, agent.engine_agent_id)
        const triggers = await listTriggers(conn, agent.engine_agent_id)
        triggerTokens.push(...triggers.map(trigger => trigger.token))
        console.log(`        ${agent.handle}: ${skills.length} skill(s), ${triggers.length} webhook(s), ${detail.config.mcpServers.length} mcp server(s)`)
    }

    if (triggerTokens.length > 0) {
        check('every webhook was issued a token of its own', new Set(triggerTokens).size === triggerTokens.length, `${triggerTokens.length} webhook(s), ${new Set(triggerTokens).size} distinct token(s)`)
        check('no webhook arrived without a token', triggerTokens.every(token => token.length > 0))
    }
} finally {
    console.log('\ncleanup')
    const conn = await getSpaceConnection(SPACE_ID).catch(() => null)
    for (const agent of created) {
        if (conn && agent.engineAgentId) await engineDeleteAgent(conn, agent.engineAgentId).catch(() => {})
        await supabase.from('agents').delete().eq('id', agent.id)
    }
    console.log(`  removed ${created.length} agent(s)`)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
