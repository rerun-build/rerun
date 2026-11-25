import { Hono } from 'hono'
import { refreshBrand } from '../../brand/brand.js'
import { toolCatalog } from '../../tools/catalog.js'

export const toolRoutes = new Hono()

toolRoutes.get('/', async c => {
    await refreshBrand()
    return c.json({ families: toolCatalog() })
})
