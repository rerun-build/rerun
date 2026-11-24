import type { Brand } from '@rerun/contracts'

import { brandCss } from '@/lib/brand/css'

// In the server's HTML, before the first paint: the page never flashes Rerun's colors.
export function BrandStyle({ brand }: { brand: Brand }) {
    const css = brandCss(brand)
    return css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null
}
