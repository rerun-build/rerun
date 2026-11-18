import { R_PATH } from '@rerun/ui/logo'

const LANDING_URL = 'https://rerun.build'
const REPORT_EMAIL = 'help@rerun.build'

const BADGE_STYLE = `
:host{all:initial}
.badge{position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;align-items:center;gap:2px;padding:4px;border-radius:999px;background:#0b0b0c;border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 24px rgba(0,0,0,.24);font:500 12px/1 system-ui,-apple-system,sans-serif;color:#fafafa}
a,button{all:unset;cursor:pointer;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;color:inherit}
a:hover,button:hover{background:rgba(255,255,255,.08)}
a:focus-visible,button:focus-visible{outline:2px solid #fafafa}
.report{color:rgba(250,250,250,.56)}
button{padding:6px 8px;color:rgba(250,250,250,.56)}
svg{width:14px;height:14px}
@media print{.badge{display:none}}
`

function badgeMarkup(slug: string): string {
    const landing = `${LANDING_URL}/?utm_source=published&utm_medium=badge&utm_content=${slug}`
    const report = `mailto:${REPORT_EMAIL}?subject=${encodeURIComponent(`Report published page ${slug}`)}`
    return (
        `<style>${BADGE_STYLE}</style>` +
        `<div class="badge">` +
        `<a href="${landing}" target="_blank" rel="noopener"><svg viewBox="0 0 512 512" aria-hidden="true"><path d="${R_PATH}" fill="currentColor"/></svg>Made with Moldwright</a>` +
        `<a class="report" href="${report}">Report</a>` +
        `<button type="button" aria-label="Hide">&#x2715;</button>` +
        `</div>`
    )
}

function badgeScript(slug: string): string {
    const key = `rerun-badge-hidden:${slug}`
    return (
        `<script>(function(){` +
        `try{if(sessionStorage.getItem(${JSON.stringify(key)}))return}catch(e){}` +
        `var host=document.createElement('rerun-badge');` +
        `var root=host.attachShadow({mode:'closed'});` +
        `root.innerHTML=${JSON.stringify(badgeMarkup(slug))};` +
        `root.querySelector('button').addEventListener('click',function(){host.remove();try{sessionStorage.setItem(${JSON.stringify(key)},'1')}catch(e){}});` +
        `(document.body||document.documentElement).appendChild(host);` +
        `})()</script>`
    )
}

export function injectBadge(html: string, slug: string): string {
    const script = badgeScript(slug)
    const bodyEnd = html.toLowerCase().lastIndexOf('</body>')
    if (bodyEnd === -1) return html + script
    return html.slice(0, bodyEnd) + script + html.slice(bodyEnd)
}
