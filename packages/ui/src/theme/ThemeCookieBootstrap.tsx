import { THEME_COOKIE, THEME_STORAGE_KEY } from './theme-cookie'

const SCRIPT = `try{var k=${JSON.stringify(THEME_STORAGE_KEY)};if(!localStorage.getItem(k)){var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);if(m)localStorage.setItem(k,decodeURIComponent(m[1]))}}catch(e){}`

export function ThemeCookieBootstrap() {
    return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
}
