const SCRIPT = `(function(){if(typeof Node!=='function'||window.__domGuard)return;window.__domGuard=true;var p=Node.prototype,r=p.removeChild,i=p.insertBefore;p.removeChild=function(c){if(c&&c.parentNode!==this){console.warn('[dom-guard] removeChild skipped: node moved by a third party');return c}return r.apply(this,arguments)};p.insertBefore=function(n,f){if(f&&f.parentNode!==this){console.warn('[dom-guard] insertBefore skipped: reference node moved by a third party');return n}return i.apply(this,arguments)}})()`

export function DomMutationGuard() {
    return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />
}
