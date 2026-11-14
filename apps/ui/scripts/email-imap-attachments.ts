import type { Database, Json } from '@/app/api/database.types'
import { serviceManifestSchema } from '../lib/services/manifest'
import { createServiceRoleClient } from '../supabase/serviceRole'
import { selectSingle } from '../supabase/supabase-helpers'

const SLUG = 'email-imap-smtp'
const OLD_SENTENCE = 'Saving attachments to disk is not available.'
const NEW_SENTENCE =
    'To get the file of an attachment, call save_attachment with savePath set to the absolute path of the mail-attachments folder inside your workspace, then read or upload the saved file with shell_exec. Never set returnBase64.'

type ServiceUpdate = Database['public']['Tables']['services']['Update']
type RawManifest = { mcpServers: { name: string; env: Record<string, string> }[]; skills: { body: string }[] }

async function main() {
    const write = process.argv.includes('--write')
    const supabase = createServiceRoleClient()
    const { data, error } = await selectSingle(supabase, 'services', ['manifest'] as const, { slug: SLUG })
    if (error || !data) throw error ?? new Error(`${SLUG} not found`)

    serviceManifestSchema.parse(data.manifest)
    const raw = structuredClone(data.manifest) as unknown as RawManifest
    const server = raw.mcpServers.find(s => s.name === 'email')
    if (!server) throw new Error('no "email" server in the manifest')
    server.env.MAIL_ALLOWED_ROOTS = '${RERUN_WORKSPACE}'
    const skill = raw.skills.find(s => s.body.includes(OLD_SENTENCE) || s.body.includes(NEW_SENTENCE))
    if (!skill) throw new Error('usage skill sentence not found')
    skill.body = skill.body.replace(OLD_SENTENCE, NEW_SENTENCE)
    serviceManifestSchema.parse(raw)

    console.log(JSON.stringify({ env: server.env.MAIL_ALLOWED_ROOTS, skill: skill.body }, null, 2))
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
