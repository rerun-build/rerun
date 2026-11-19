#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const USAGE = 'usage: code-q <repo> <tool> [json] | <repo> --list | --status';
const args = process.argv.slice(2);
const [repo, tool, json] = args;
const statusMode = args.length === 1 && repo === '--status';
if (!statusMode && (!repo || !tool || args.length > 3 || (tool === '--list' && args.length !== 2))) {
  console.error(USAGE);
  process.exit(2);
}
if (!statusMode && tool === 'index_folder') {
  console.error('code-q: index_folder is not allowed');
  process.exit(2);
}

const defaults = {
  symforge: '/data/tools/bin/symforge',
  checkouts: '/data/work/repos',
  keyFile: '/data/tools/etc/code-intel.key',
  servers: {},
};
const configPath = process.env.CODE_Q_CONFIG || '/data/tools/etc/code-q.json';
let fileConfig = {};
if (existsSync(configPath)) fileConfig = JSON.parse(readFileSync(configPath, 'utf8'));
const config = { ...defaults, ...fileConfig };
const retryMs = Number(process.env.CODE_Q_RETRY_MS || 2000);
const sleep = ms => new Promise(res => setTimeout(res, ms));
const loading = text => /^Index is loading|indexing of this project is in progress/.test(text);
const listing = tool === '--list';

async function statusLine(name, url, key) {
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'health', arguments: {} } }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return [`${name} down`, false];
  }
  if (res.status === 401) return [`${name} up key refused`, false];
  let first = '';
  try {
    const raw = await res.text();
    const data = (res.headers.get('content-type') || '').startsWith('text/event-stream')
      ? raw.split('\n').filter(l => l.startsWith('data:')).pop().slice(5).trim()
      : raw;
    first = JSON.parse(data).result?.content?.[0]?.text || '';
  } catch {
    return [`${name} up loading`, false];
  }
  const files = /Files:\s+(\d+) indexed/.exec(first);
  if (!/Status: Ready/.test(first) || !files) return [`${name} up loading`, false];
  let age = 'never';
  try {
    const mtime = statSync(join(config.checkouts, name, '.git', 'FETCH_HEAD')).mtimeMs;
    age = `${Math.floor(Math.max(0, Date.now() - mtime) / 3600000)}h ago`;
  } catch {}
  return [`${name} up ready ${files[1]} files fetched ${age}`, true];
}

if (statusMode) {
  const names = Object.keys(config.servers);
  if (!names.length) {
    console.log('code-q: no servers configured');
    process.exit(1);
  }
  let key;
  try {
    key = readFileSync(config.keyFile, 'utf8').trim();
  } catch {
    console.error(`code-q: cannot read the key file ${config.keyFile}`);
    process.exit(1);
  }
  const rows = await Promise.all(names.map(n => statusLine(n, config.servers[n], key)));
  for (const [line] of rows) console.log(line);
  process.exit(rows.every(([, ok]) => ok) ? 0 : 1);
}

function show(r) {
  if (listing) {
    const tools = r.result.tools;
    const chars = JSON.stringify(tools).length;
    console.log(`${tools.length} tools, ${chars} characters of descriptions and schemas (about ${Math.round(chars / 3.6)} tokens)`);
    const sorted = [...tools].sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length);
    for (const t of sorted.slice(0, process.env.LIST_ALL ? 999 : 5)) console.log('  ', t.name, JSON.stringify(t).length);
    return 0;
  }
  if (r.error) {
    console.error('error:', r.error.message);
    return 1;
  }
  for (const c of r.result.content || []) if (c.type === 'text') console.log(c.text);
  return 0;
}

class Refused extends Error {}

async function viaServer(url) {
  const key = readFileSync(config.keyFile, 'utf8').trim();
  const method = listing ? 'tools/list' : 'tools/call';
  const params = listing ? {} : { name: tool, arguments: JSON.parse(json || '{}') };
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
  let r;
  for (let i = 0; i < 60; i++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${key}`,
      },
      body,
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 401) throw new Refused();
    const raw = await res.text();
    if ((res.headers.get('content-type') || '').startsWith('text/event-stream')) {
      const lines = raw.split('\n').filter(l => l.startsWith('data:'));
      r = JSON.parse(lines[lines.length - 1].slice(5).trim());
    } else {
      r = JSON.parse(raw);
    }
    const first = r.result?.content?.[0]?.text || '';
    if (listing || !loading(first)) break;
    await sleep(retryMs);
  }
  return r;
}

async function viaStdio() {
  const cwd = join(config.checkouts, repo);
  if (!existsSync(cwd)) {
    console.error(`code-q: no checkout ${cwd}`);
    return 2;
  }
  const child = spawn(config.symforge, [], { cwd, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, SYMFORGE_NO_DAEMON: '1' } });
  let buf = '';
  let nextId = 1;
  const waiting = new Map();
  child.stdout.on('data', d => {
    buf += d;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)(m);
        waiting.delete(m.id);
      }
    }
  });
  const send = o => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
  const ask = (method, params) => new Promise((res, rej) => {
    const id = nextId++;
    waiting.set(id, res);
    send({ id, method, params });
    setTimeout(() => rej(new Error('timeout: ' + method)), 120000);
  });
  let code = 0;
  try {
    await ask('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'code-q', version: '1' } });
    send({ method: 'notifications/initialized' });
    let r;
    if (listing) {
      r = await ask('tools/list', {});
    } else {
      for (let i = 0; i < 60; i++) {
        r = await ask('tools/call', { name: tool, arguments: JSON.parse(json || '{}') });
        if (!loading(r.result?.content?.[0]?.text || '')) break;
        await sleep(retryMs);
      }
    }
    code = show(r);
  } catch (e) {
    console.error(String(e.message));
    code = 1;
  }
  child.stdin.end();
  child.kill();
  await Promise.race([new Promise(r => child.once('exit', r)), sleep(3000)]);
  return code;
}

let code;
const url = config.servers[repo];
if (url) {
  try {
    code = show(await viaServer(url));
  } catch (e) {
    if (e instanceof Refused) {
      console.error(`code-q: the server for ${repo} refused the key`);
      code = 1;
    } else if (e instanceof SyntaxError || e instanceof TypeError && !e.cause) {
      console.error(String(e.message));
      code = 1;
    } else {
      console.error(`code-q: the server for ${repo} did not answer; asking a one-off symforge instead`);
      code = await viaStdio();
    }
  }
} else {
  console.error(`code-q: no server for ${repo}; asking a one-off symforge instead`);
  code = await viaStdio();
}
process.exit(code);
