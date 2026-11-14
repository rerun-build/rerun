import { handleAccountMcp } from '@/lib/mcp/account-rpc'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }): Promise<Response> {
    const { key } = await params
    return handleAccountMcp(req, key, { importOnly: true })
}
