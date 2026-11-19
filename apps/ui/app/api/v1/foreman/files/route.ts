import { foremanEngineFilesAction } from '@/app/api/_actions/foreman-file.actions'
import { apiRoute } from '@/app/api/v1/_lib/api-route'
import { mobileApi, type ForemanEngineFiles } from '@rerun/contracts'

export const dynamic = 'force-dynamic'

export const GET = apiRoute(mobileApi.getForemanEngineFiles, { auth: 'member' }, async (): Promise<ForemanEngineFiles> => ({ supported: await foremanEngineFilesAction() }))
