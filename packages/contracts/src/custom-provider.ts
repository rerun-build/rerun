import { z } from 'zod'
import { discoveredModelSchema } from './connection.js'

export const CUSTOM_DEFAULT_CONTEXT_WINDOW = 128_000

export const CUSTOM_PRESETS = [
    { id: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', keyRequired: false, local: true },
    { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', keyRequired: false, local: true },
    { id: 'vllm', label: 'vLLM', baseUrl: 'http://localhost:8000/v1', keyRequired: false, local: true },
    { id: 'litellm', label: 'LiteLLM', baseUrl: 'http://localhost:4000/v1', keyRequired: true, local: true },
    { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyRequired: true, local: false },
    { id: 'together', label: 'Together', baseUrl: 'https://api.together.xyz/v1', keyRequired: true, local: false },
    { id: 'mistral', label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyRequired: true, local: false },
    { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyRequired: true, local: false },
] as const
export type CustomPreset = (typeof CUSTOM_PRESETS)[number]

export const customProbeInputSchema = z.object({
    baseUrl: z.url(),
    apiKey: z.string().trim().optional(),
    model: z.string().trim().min(1).optional(),
})
export type CustomProbeInput = z.infer<typeof customProbeInputSchema>

export const customProbeProblemSchema = z.enum(['unreachable', 'unauthorized', 'not_listed', 'model_refused'])
export type CustomProbeProblem = z.infer<typeof customProbeProblemSchema>

export const customProbeResultSchema = z.object({
    baseUrl: z.string(),
    models: z.array(discoveredModelSchema),
    problem: customProbeProblemSchema.nullable(),
    detail: z.string().nullable(),
})
export type CustomProbeResult = z.infer<typeof customProbeResultSchema>
