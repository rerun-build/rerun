// `window.rerun.data`, put in the head of a published page that was granted tables, so the
// coworker's own scripts find it whatever their place in the page. Every call goes through the
// page's own host (`/__rerun/data`), with the visitor's access cookie.
//
//   rerun.data.tables()                       → [{ name, grant, columns }]
//   rerun.data.rows(table, { limit, offset, sort, dir, q, where }) → { columns, rows, total }
//   rerun.data.add(table, values)             → the new row, with its __rowid
//   rerun.data.update(table, rowid, values)   → the row as saved
//   rerun.data.watch(table, options, onRows)  → reads now, then every 5 s while the tab is visible;
//                                               returns a function that stops it
const DATA_WATCH_INTERVAL_MS = 5000

const DATA_CLIENT_SCRIPT =
    `<script>(function(){` +
    `var base='/__rerun/data/tables';` +
    `function call(method,path,body){` +
    `return fetch(base+path,{method:method,credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined})` +
    `.then(function(r){return r.json().catch(function(){return{}}).then(function(d){if(!r.ok)throw new Error(d.error||('Request failed: '+r.status));return d})})}` +
    `function table(name){return '/'+encodeURIComponent(name)+'/rows'}` +
    `function query(o){o=o||{};var p=new URLSearchParams();` +
    `['limit','offset','sort','dir','q'].forEach(function(k){if(o[k]!==undefined&&o[k]!==null&&o[k]!=='')p.set(k,String(o[k]))});` +
    `if(o.columns)p.set('columns',[].concat(o.columns).join(','));` +
    `if(o.where)p.set('where',JSON.stringify(o.where));` +
    `var s=p.toString();return s?'?'+s:''}` +
    `var data={` +
    `tables:function(){return call('GET','').then(function(d){return d.tables})},` +
    `rows:function(name,o){return call('GET',table(name)+query(o))},` +
    `add:function(name,values){return call('POST',table(name),{values:values}).then(function(d){return d.row})},` +
    `update:function(name,rowid,values){return call('PATCH',table(name)+'/'+encodeURIComponent(rowid),{values:values}).then(function(d){return d.row})},` +
    `watch:function(name,o,cb){if(typeof o==='function'){cb=o;o={}}var stopped=false,timer;` +
    `function next(ms){if(!stopped)timer=setTimeout(tick,ms)}` +
    `function tick(){if(stopped)return;if(document.hidden){next(1000);return}` +
    `data.rows(name,o).then(cb).catch(function(e){console.warn('rerun.data.watch',e)}).then(function(){next(${DATA_WATCH_INTERVAL_MS})})}` +
    `tick();return function(){stopped=true;clearTimeout(timer)}}` +
    `};` +
    `window.rerun=window.rerun||{};window.rerun.data=data;` +
    `})()</script>`

export function injectDataClient(html: string): string {
    const opening = /<head\b[^>]*>/i.exec(html) ?? /<html\b[^>]*>/i.exec(html)
    if (opening) {
        const at = opening.index + opening[0].length
        return html.slice(0, at) + DATA_CLIENT_SCRIPT + html.slice(at)
    }
    const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
    const at = doctype ? doctype[0].length : 0
    return html.slice(0, at) + DATA_CLIENT_SCRIPT + html.slice(at)
}
