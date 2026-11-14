import { rerunModels } from '@rerun/cloud/llm'

export async function GET(req: Request) {
    return rerunModels(req)
}
