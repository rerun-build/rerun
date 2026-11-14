import { z } from 'zod'

export const CAPTCHA_PROVIDERS = ['turnstile', 'hcaptcha'] as const
export type CaptchaProvider = (typeof CAPTCHA_PROVIDERS)[number]

export const captchaProofSchema = z.object({ provider: z.enum(CAPTCHA_PROVIDERS), token: z.string().max(4096) })
export type CaptchaProof = z.infer<typeof captchaProofSchema>
