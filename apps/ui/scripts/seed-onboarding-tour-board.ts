import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { MODEL_LOGOS, type ModelLogoSlug } from '../../../packages/ui/src/beams/model-logos'

const MODEL_MARKS: readonly { id: string; slug: ModelLogoSlug; color: string }[] = [
    { id: 'anthropic', slug: 'anthropic', color: '#D97757' },
    { id: 'openai', slug: 'openai', color: '#000000' },
    { id: 'grok', slug: 'grok', color: '#000000' },
    { id: 'openrouter', slug: 'openrouter', color: '#000000' },
]

const SERVICE_MARKS: readonly { id: string; icon: string; color: string; pad?: number }[] = [
    { id: 'semrush', icon: 'semrush', color: 'FF642D', pad: 0.78 },
    { id: 'webflow', icon: 'webflow', color: '146EF5', pad: 0.78 },
    { id: 'instagram', icon: 'instagram', color: 'FF0069' },
    { id: 'tiktok', icon: 'tiktok', color: '000000' },
    { id: 'reddit', icon: 'reddit', color: 'FF4500' },
    { id: 'hubspot', icon: 'hubspot', color: 'FF7A59' },
    { id: 'gmail', icon: 'gmail', color: 'EA4335' },
    { id: 'calendly', icon: 'calendly', color: '006BFF' },
    { id: 'stripe', icon: 'stripe', color: '635BFF' },
    { id: 'google-sheets', icon: 'googlesheets', color: '34A853' },
    { id: 'notion', icon: 'notion', color: '000000' },
]

const PINNED_SIMPLE_ICONS = 'https://unpkg.com/simple-icons@11/icons'
const LEGACY_MARKS: readonly { id: string; icon: string; color: string; pad?: number }[] = [{ id: 'linkedin', icon: 'linkedin', color: '#0A66C2', pad: 0.72 }]

const SLACK_MARK = `<svg viewBox="0 0 122.8 122.8" xmlns="http://www.w3.org/2000/svg">
  <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#e01e5a"/>
  <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36c5f0"/>
  <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2eb67d"/>
  <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ecb22e"/>
</svg>`

function padMark(svg: string, pad?: number) {
    if (!pad) return svg
    const offset = (24 * (1 - pad)) / 2
    return svg
        .replace(/(<svg[^>]*>)/, `$1<g transform="translate(${offset} ${offset}) scale(${pad})">`)
        .replace('</svg>', '</g></svg>')
}

const PEOPLE: readonly { id: string; portrait: string }[] = [
    { id: 'theo', portrait: 'men/32' },
    { id: 'sofia', portrait: 'women/44' },
    { id: 'noah', portrait: 'men/11' },
]

const PUBLIC_ROOTS = [path.join(process.cwd(), 'public'), path.resolve(process.cwd(), '..', 'landing', 'public')]
const OUT_DIRS = PUBLIC_ROOTS.map(root => path.join(root, 'onboarding', 'tour', 'board'))
const TEAM_DIRS = PUBLIC_ROOTS.map(root => path.join(root, 'onboarding', 'tour', 'team'))

async function writeMark(file: string, content: string | Buffer) {
    for (const dir of OUT_DIRS) await writeFile(path.join(dir, file), content)
}

async function writePortrait(file: string, content: Buffer) {
    for (const dir of TEAM_DIRS) await writeFile(path.join(dir, file), content)
}

function modelSvg(slug: ModelLogoSlug, color: string) {
    const logo = MODEL_LOGOS[slug]
    const rule = 'evenodd' in logo && logo.evenodd ? ' fill-rule="evenodd"' : ''
    const paths = logo.paths.map(d => `<path${rule} d="${d}"/>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${color}">${paths}</svg>`
}

async function fetchOk(url: string): Promise<Response> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`)
    return res
}

async function main() {
    for (const dir of [...OUT_DIRS, ...TEAM_DIRS]) await mkdir(dir, { recursive: true })

    for (const { id, slug, color } of MODEL_MARKS) {
        await writeMark(`${id}.svg`, modelSvg(slug, color))
        console.log(`  ${id}: model mark ${color}`)
    }

    for (const { id, icon, color, pad } of SERVICE_MARKS) {
        const mark = await fetchOk(`https://cdn.simpleicons.org/${icon}/${color}`)
        await writeMark(`${id}.svg`, padMark(await mark.text(), pad))
        console.log(`  ${id}: ${icon} mark`)
    }

    for (const { id, icon, color, pad } of LEGACY_MARKS) {
        const raw = await (await fetchOk(`${PINNED_SIMPLE_ICONS}/${icon}.svg`)).text()
        const mark = raw.replace(/<title>.*?<\/title>/, '').replace('<svg ', `<svg fill="${color}" `)
        await writeMark(`${id}.svg`, padMark(mark, pad))
        console.log(`  ${id}: ${icon} mark ${color} (pinned)`)
    }

    await writeMark('slack.svg', SLACK_MARK)
    console.log('  slack: multicolour mark')

    for (const { id, portrait } of PEOPLE) {
        const photo = await fetchOk(`https://randomuser.me/api/portraits/${portrait}.jpg`)
        const webp = await sharp(Buffer.from(await photo.arrayBuffer())).resize(128, 128, { fit: 'cover' }).webp({ quality: 80 }).toBuffer()
        await writePortrait(`${id}.webp`, webp)
        console.log(`  ${id}: ${(webp.length / 1024).toFixed(1)} KB portrait`)
    }

    console.log(`\n${MODEL_MARKS.length + SERVICE_MARKS.length + LEGACY_MARKS.length + 1} mark(s) and ${PEOPLE.length} portrait(s) written under ${PUBLIC_ROOTS.length} public/onboarding/tour/.`)
}

main().catch(err => {
    console.error(err)
    process.exit(1)
})
