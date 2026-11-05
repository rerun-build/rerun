import type { Database, Json } from '@/app/api/database.types'
import { serviceManifestSchema } from '../lib/services/manifest'
import { createServiceRoleClient } from '../supabase/serviceRole'
import { selectSingle } from '../supabase/supabase-helpers'

// One-shot: pins the email-imap-smtp service to port 587 with STARTTLS. Hetzner drops outbound 25
// and 465 on every engine host, so a box can only send over 587: the port and encryption fields go
// away from the install form instead of steering users onto a dead port.
//
//   ../engine/node_modules/.bin/tsx --env-file=.env scripts/email-smtp-587.ts [--write]
//
// Add `--env-file=.env.profile.staging` after `.env` to target the staging project.

const SLUG = 'email-imap-smtp'
const REMOVED_INPUTS = ['SMTP_PORT', 'SMTP_SECURE']
const HOST_HELP_SUFFIX = ' It must accept STARTTLS on port 587.'
const SKILL_ANCHOR = 'Call check_connection first when a mail call fails, it tests IMAP and SMTP and says which one is wrong.'
const SKILL_SENTENCE =
    'Sending always goes through port 587 with STARTTLS, the only SMTP port open from this machine: an SMTP failure means a wrong server address or password, never a port to change.'

type ServiceUpdate = Database['public']['Tables']['services']['Update']
type RawManifest = {
    inputs: { key: string; help?: string }[]
    mcpServers: { name: string; env: Record<string, string> }[]
    skills: { body: string }[]
}

async function main() {
    const write = process.argv.includes('--write')
    const supabase = createServiceRoleClient()
    const { data, error } = await selectSingle(supabase, 'services', ['manifest'] as const, { slug: SLUG })
    if (error || !data) throw error ?? new Error(`${SLUG} not found`)

    serviceManifestSchema.parse(data.manifest)
    const raw = structuredClone(data.manifest) as unknown as RawManifest

    raw.inputs = raw.inputs.filter(input => !REMOVED_INPUTS.includes(input.key))
    const hostInput = raw.inputs.find(input => input.key === 'SMTP_HOST')
    if (!hostInput) throw new Error('no SMTP_HOST input in the manifest')
    if (!hostInput.help?.endsWith(HOST_HELP_SUFFIX)) hostInput.help = `${hostInput.help ?? ''}${HOST_HELP_SUFFIX}`.trim()

    const server = raw.mcpServers.find(s => s.name === 'email')
    if (!server) throw new Error('no "email" server in the manifest')
    server.env.SMTP_PORT = '587'
    server.env.SMTP_SECURE = 'false'

    const skill = raw.skills.find(s => s.body.includes(SKILL_ANCHOR))
    if (!skill) throw new Error('usage skill anchor sentence not found')
    if (!skill.body.includes(SKILL_SENTENCE)) skill.body = skill.body.replace(SKILL_ANCHOR, `${SKILL_ANCHOR} ${SKILL_SENTENCE}`)

    serviceManifestSchema.parse(raw)

    const unchanged = JSON.stringify(raw) === JSON.stringify(data.manifest)
    console.log(
        JSON.stringify(
            { inputs: raw.inputs.map(input => input.key), hostHelp: hostInput.help, env: { SMTP_PORT: server.env.SMTP_PORT, SMTP_SECURE: server.env.SMTP_SECURE }, skill: skill.body },
            null,
            2,
        ),
    )
    if (unchanged) return console.log(`already up to date on ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
    if (!write) return console.log(`dry run on ${process.env.NEXT_PUBLIC_SUPABASE_URL}, pass --write`)

    const { error: updateError } = await supabase
        .from('services')
        .update<ServiceUpdate>({ manifest: raw as unknown as Json })
        .eq('slug', SLUG)
    if (updateError) throw updateError
    console.log(`written on ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
