import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import { generateText } from 'ai'
import { tool, type ModelMessage, type ToolSet } from 'ai'
import { z } from 'zod'
import { resolveInWorkspace } from '../sandbox.js'
import { CLI_PROVIDERS, modelFor, type ModelOverride } from '../../agents/providers.js'
import { modelSeesImages, opencodeVisionModel } from '../../agents/opencode.js'
import { ensureCliAuth } from '../../connections/cli-auth.js'
import { deadlineSignal, raceAbort } from '../../lib/abort.js'
import type { RunContext } from '../../runtime/context.js'

const MEDIA_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
}

const CLAUDE_VISION_TOOLS = ['Read'] as const

const VISION_TIMEOUT_MS = 10 * 60 * 1000

const VISION_MAX_EDGE = 2048
const VISION_MAX_BYTES = 4 * 1024 * 1024

async function downscaleForVision(image: Buffer, mediaType: string): Promise<{ image: Buffer; mediaType: string }> {
    const { default: sharp } = await import('sharp')
    const { width = 0, height = 0 } = await sharp(image).metadata()
    if (Math.max(width, height) <= VISION_MAX_EDGE && image.byteLength <= VISION_MAX_BYTES) return { image, mediaType }
    const reduced = await sharp(image).rotate().resize(VISION_MAX_EDGE, VISION_MAX_EDGE, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
    return { image: reduced, mediaType: 'image/webp' }
}

async function imageMessages(ctx: RunContext, target: string, mediaType: string, prompt: string): Promise<ModelMessage[]> {
    if (CLI_PROVIDERS.has(ctx.agent.resolved.provider)) {
        return [{ role: 'user', content: `Open the image file at ${target} with your file reader, then answer about what it shows and nothing else.\n\n${prompt}` }]
    }
    const sent = await downscaleForVision(await readFile(target), mediaType)
    return [{ role: 'user', content: [{ type: 'image', image: sent.image, mediaType: sent.mediaType }, { type: 'text', text: prompt }] }]
}

export const NO_VISION_MODEL =
    'None of the models switched on for this OpenCode connection can read images. Switch one on that can (most Go models do), or go on without the image.'

function visionModelFor(ctx: RunContext): ModelOverride | undefined | null {
    const { provider, model, connection } = ctx.agent.resolved
    if (modelSeesImages(provider, model, connection)) return undefined
    const seeing = opencodeVisionModel(connection)
    return seeing ? { model: seeing } : null
}

export function visionTools(ctx: RunContext, timeoutMs = VISION_TIMEOUT_MS): ToolSet {
    const id = ctx.agent.id
    return {
        vision_analyze: tool({
            description: 'Analyze an image file from your workspace with a multimodal model. Provide a prompt describing what to look for (e.g. extract text, describe the layout, read a chart). Useful on screenshots saved by browser_navigate.',
            inputSchema: z.object({
                imagePath: z.string().describe('Workspace-relative path to a PNG, JPEG, GIF or WebP image'),
                prompt: z.string().describe('What you want to know about the image'),
            }),
            execute: async ({ imagePath, prompt }, { abortSignal }) => {
                const target = await resolveInWorkspace(id, imagePath)
                if (!existsSync(target)) return `Image not found: ${imagePath}`
                const mediaType = MEDIA_TYPES[extname(imagePath).toLowerCase()]
                if (!mediaType) return `Unsupported image type: ${imagePath}`
                let messages: ModelMessage[]
                try {
                    messages = await imageMessages(ctx, target, mediaType, prompt)
                } catch (e) {
                    return `Could not read ${imagePath} as an image: ${(e as Error).message}`
                }
                const seeing = visionModelFor(ctx)
                if (seeing === null) return NO_VISION_MODEL
                const runSignal = ctx.abortSignal ?? abortSignal
                const signal = deadlineSignal(timeoutMs, runSignal)
                let release = () => {}
                try {
                    release = await ensureCliAuth(ctx.agent.resolved.provider, ctx.agent.resolved.connection)
                    const { text } = await raceAbort(
                        generateText({
                            model: modelFor(ctx.agent, seeing, undefined, undefined, { claudeTools: CLAUDE_VISION_TOOLS, sessionId: ctx.sessionId }),
                            messages,
                            abortSignal: signal,
                        }),
                        signal,
                    )
                    return text || '(the model returned no text)'
                } catch (e) {
                    if (runSignal?.aborted) throw e
                    if (signal.aborted) {
                        ctx.logger.warn({ agent: id, provider: ctx.agent.resolved.provider, imagePath, timeoutMs }, 'vision analysis timed out')
                        return `Vision analysis timed out after ${Math.round(timeoutMs / 60_000)} min with no answer from the model. Try again, or go on without it.`
                    }
                    return `Vision analysis failed (the configured model may not support images): ${(e as Error).message}`
                } finally {
                    release()
                }
            },
        }),
    }
}
