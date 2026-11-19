import { rerunModels } from '@moldwright/cloud/llm'

export async function GET(req: Request) {
    return rerunModels(req)
}
