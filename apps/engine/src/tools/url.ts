import { z } from 'zod'
import { isHttpUrl } from '../lib/public-fetch.js'

export const PUBLIC_HTTP_URL_MESSAGE = 'only http and https URLs on public hosts are accepted'

export const publicHttpUrl = z.string().url().refine(isHttpUrl, { message: PUBLIC_HTTP_URL_MESSAGE })
