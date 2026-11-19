import { CONSENT_ATTRIBUTE, CONSENT_COOKIE, CONSENT_VERSION, EEA_UK_TIME_ZONES } from '@moldwright/contracts'

const SCRIPT = `try{
var c=${JSON.stringify(CONSENT_COOKIE)},v=${JSON.stringify(CONSENT_VERSION)},z=${JSON.stringify(EEA_UK_TIME_ZONES)},s='pending';
var m=document.cookie.match(new RegExp('(?:^|; )'+c+'=([^;]*)'));
var p=m?decodeURIComponent(m[1]).split(':'):null;
if(p&&p[0]===v&&(p[1]==='granted'||p[1]==='denied'))s=p[1];
else if(z.indexOf(Intl.DateTimeFormat().resolvedOptions().timeZone)<0)s='exempt';
document.documentElement.setAttribute(${JSON.stringify(CONSENT_ATTRIBUTE)},s);
}catch(e){document.documentElement.setAttribute(${JSON.stringify(CONSENT_ATTRIBUTE)},'pending')}`

export function ConsentBootstrap() {
    return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
}
