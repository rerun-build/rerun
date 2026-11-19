import { existsSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'

import { RERUN_CLOUD } from '@moldwright/cloud/edition'

it('resolves @moldwright/cloud to cloud/ when it is there, to cloud-oss/ otherwise', () => {
    expect(RERUN_CLOUD).toBe(existsSync(path.resolve(import.meta.dirname, '../../../cloud/packages/cloud/src')))
})
