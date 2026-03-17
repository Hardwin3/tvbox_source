#!/usr/bin/env node
/**
 * TVBox 多仓源管理工具
 *
 * 多仓格式: { "urls": [{ "url": "...", "name": "..." }] }
 *
 * 用法:
 *   node check_tvbox.js add <url> [-n name]   添加源
 *   node check_tvbox.js import urls.txt        批量导入
 *   node check_tvbox.js sync                   同步所有源
 *   node check_tvbox.js index                  显示多仓文件内容
 *   node check_tvbox.js list                   列出已收录的源
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

// ============ 配置 ============
const BASE_DIR = __dirname;
const SOURCES_DIR = path.join(BASE_DIR, 'sources');
const INDEX_FILE = path.join(BASE_DIR, 'tvboxmuti.json');
const TIMEOUT = 15000;
const BASE_URL = 'https://tvboxsource.vercel.app';

// ============ 颜色 ============
const C = {
  G: '\x1b[92m', R: '\x1b[91m', Y: '\x1b[93m', B: '\x1b[94m',
  D: '\x1b[90m', BOLD: '\x1b[1m', END: '\x1b[0m'
};
const icons = {
  ok: `${C.G}[OK]${C.END}`, fail: `${C.R}[FAIL]${C.END}`,
  info: `${C.B}[INFO]${C.END}`, warn: `${C.Y}[WARN]${C.END}`, url: `${C.Y}[URL]${C.END}`
};
function log(s, m) { console.log(`  ${icons[s] || '[?]'} ${m}`); }

// ============ 工具函数 ============
function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function urlToId(url) {
  let h = 0; for (let i = 0; i < url.length; i++) h = ((h << 5) - h) + url.charCodeAt(i), h |= 0;
  return Math.abs(h).toString(16).padStart(8, '0').slice(0, 8);
}
function safeName(name) { return name.replace(/[^\w\u4e00-\u9fff\-]/g, '_').slice(0, 40); }

// ============ HTTP 请求（跟随重定向）============
function fetchRaw(url, timeout = TIMEOUT, maxRedirects = 5) {
  return new Promise((resolve) => {
    let redirects = 0;
    const go = (u) => {
      if (redirects >= maxRedirects) return resolve(null);
      const mod = u.startsWith('https') ? https : http;
      const timer = setTimeout(() => resolve(null), timeout);
      const req = mod.get(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout
      }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          clearTimeout(timer); redirects++;
          return go(new URL(res.headers.location, u).href);
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, data }); });
      });
      req.on('error', () => { clearTimeout(timer); resolve(null); });
      req.on('timeout', () => { req.destroy(); clearTimeout(timer); resolve(null); });
    };
    go(url);
  });
}

/**
 * 获取源数据
 * 返回: { type: 'json'|'multi'|'url', data?, detail? } | null
 */
async function fetchSource(url) {
  const result = await fetchRaw(url);
  if (!result || result.status >= 400) return null;

  const raw = result.data;
  try {
    const json = JSON.parse(raw);
    if (json.urls || json.storeHouse) return { type: 'multi', data: json };
    if (json.sites) return { type: 'json', data: json };
    return { type: 'url', detail: 'JSON 但无 sites/urls' };
  } catch {}

  if (raw.includes('<html') || raw.includes('<!DOCTYPE') || raw.includes('<head')) {
    return { type: 'url', detail: 'HTML 导航页' };
  }

  const b64 = raw.match(/[A-Za-z0-9+\/]{200,}={0,2}/g);
  if (b64) {
    for (const m of b64) {
      try {
        const d = Buffer.from(m, 'base64').toString('utf8');
        if (d.includes('"sites"')) return { type: 'url', detail: '嵌入式 JSON' };
      } catch {}
    }
  }

  return { type: 'url', detail: '未知格式' };
}

// ============ 索引管理 ============
// 格式: { "urls": [{ "url": "...", "name": "...", type?, localFile?, detail? }] }
function getIndex() {
  const metaFile = path.join(BASE_DIR, '_meta.json');
  if (fs.existsSync(metaFile)) try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
  if (fs.existsSync(INDEX_FILE)) try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch {}
  return { urls: [] };
}

function saveIndex(index) {
  // 给 TVBox 用的干净版本
  const tvboxFormat = {
    urls: (index.urls || []).map(item => ({
      url: item.type === 'local' && item.localFile
        ? `${BASE_URL}/sources/${item.localFile}`
        : item.url,
      name: item.name
    }))
  };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(tvboxFormat, null, 2), 'utf8');

  // 管理元数据
  fs.writeFileSync(path.join(BASE_DIR, '_meta.json'), JSON.stringify(index, null, 2), 'utf8');
}

// ============ 添加源 ============
async function cmdAdd(url, name) {
  ensureDir(SOURCES_DIR);
  console.log(`${C.BOLD}处理: ${url}${C.END}`);

  const result = await fetchSource(url);
  if (!result) { log('fail', '无法访问'); return false; }

  let sourceName = name;
  if (!sourceName) {
    try {
      const u = new URL(url);
      sourceName = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      sourceName = sourceName.replace('.json', '') || u.hostname;
    } catch {
      sourceName = urlToId(url);
    }
  }

  const index = getIndex();
  if (index.urls.some(i => i.url === url)) {
    log('warn', `已存在: ${sourceName}`);
    return true;
  }

  if (result.type === 'multi') {
    // 多仓 → 递归处理子源（兼容 urls 和 storeHouse 两种格式）
    const entries = result.data.urls || result.data.storeHouse || [];
    log('info', `多仓源, ${entries.length} 个子源`);
    for (const entry of entries) {
      const childUrl = entry.url || entry.sourceUrl;
      const childName = entry.name || entry.sourceName || '未命名';
      if (childUrl) await cmdAdd(childUrl, childName);
    }
    return true;
  }

  if (result.type === 'json') {
    const fname = `${safeName(sourceName)}_${urlToId(url)}.json`;
    fs.writeFileSync(path.join(SOURCES_DIR, fname), JSON.stringify(result.data, null, 2), 'utf8');
    const siteCount = result.data.sites?.length || 0;
    log('ok', `${sourceName} → 本地文件 (${siteCount} 站点)`);
    index.urls.push({
      url, name: sourceName, localFile: fname,
      type: 'local', siteCount, addTime: new Date().toISOString()
    });
  } else {
    log('url', `${sourceName} → 直接使用 URL (${result.detail})`);
    index.urls.push({
      url, name: sourceName,
      type: 'remote', detail: result.detail, addTime: new Date().toISOString()
    });
  }

  saveIndex(index);
  return true;
}

// ============ 同步所有源 ============
async function cmdSync() {
  const index = getIndex();
  if (!index.urls.length) { log('info', '索引为空'); return; }

  console.log(`\n${C.BOLD}同步 ${index.urls.length} 个源${C.END}`);
  console.log('='.repeat(60));

  const newIndex = { urls: [] };
  for (const item of index.urls) {
    console.log(`\n${C.BOLD}${item.name}${C.END}: ${item.url}`);
    const result = await fetchSource(item.url);

    if (!result) {
      log('fail', '无法访问, 跳过');
      newIndex.urls.push({ ...item, status: 'unreachable' });
      continue;
    }

    if (result.type === 'json') {
      const fname = item.localFile || `${safeName(item.name)}_${urlToId(item.url)}.json`;
      fs.writeFileSync(path.join(SOURCES_DIR, fname), JSON.stringify(result.data, null, 2), 'utf8');
      const siteCount = result.data.sites?.length || 0;
      log('ok', `已更新 (${siteCount} 站点)`);
      newIndex.urls.push({
        ...item, localFile: fname, type: 'local',
        siteCount, lastSync: new Date().toISOString()
      });
    } else {
      log('url', `远程 URL (${result.detail})`);
      newIndex.urls.push({
        ...item, type: 'remote',
        detail: result.detail, lastSync: new Date().toISOString()
      });
    }
  }

  saveIndex(newIndex);
  console.log(`\n${C.G}同步完成${C.END}\n`);
}

// ============ 显示多仓内容 ============
function cmdIndex() {
  const index = getIndex();
  if (!index.urls.length) { log('info', '索引为空'); return; }

  console.log(`\n${C.BOLD}tvboxmuti.json (${index.urls.length} 个源)${C.END}`);
  console.log('='.repeat(60));
  for (const item of index.urls) {
    const url = item.type === 'local' && item.localFile
      ? `${BASE_URL}/sources/${item.localFile}`
      : item.url;
    const type = item.type === 'local' ? `(${item.siteCount || '?'}站)` : '(远程)';
    log(item.type === 'local' ? 'info' : 'url', `${item.name} → ${url} ${type}`);
  }
  console.log();
}

// ============ 列出源 ============
function cmdList() {
  const index = getIndex();
  if (!index.urls.length) { log('info', '暂无收录的源'); return; }
  console.log(`\n${C.BOLD}已收录 ${index.urls.length} 个源:${C.END}`);
  console.log('='.repeat(60));
  index.urls.forEach((item, i) => {
    const type = item.type === 'local' ? `[本地 ${item.siteCount || '?'}站]` : '[远程]';
    const status = item.status === 'unreachable' ? ` ${C.R}(失效)${C.END}` : '';
    console.log(`  ${i + 1}. ${C.BOLD}${item.name}${C.END} ${type}${status}`);
    console.log(`     ${C.D}${item.url}${C.END}`);
  });
  console.log();
}

// ============ 主入口 ============
async function main() {
  const [,, cmd, ...args] = process.argv;
  switch (cmd) {
    case 'add': {
      if (!args[0]) { console.log('用法: node check_tvbox.js add <url> [-n name]'); return; }
      const ni = args.indexOf('-n');
      await cmdAdd(args[0], ni >= 0 ? args[ni + 1] : undefined);
      break;
    }
    case 'import': {
      if (!args[0]) { console.log('用法: node check_tvbox.js import urls.txt'); return; }
      const entries = fs.readFileSync(args[0], 'utf8').split('\n')
        .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
        .map(l => {
          const hashIdx = l.indexOf('#');
          if (hashIdx > 0) return { url: l.slice(0, hashIdx).trim(), name: l.slice(hashIdx + 1).trim() };
          return { url: l, name: undefined };
        });
      log('info', `共 ${entries.length} 个 URL`);
      for (let i = 0; i < entries.length; i++) {
        console.log(`\n${C.BOLD}[${i + 1}/${entries.length}]${C.END}`);
        await cmdAdd(entries[i].url, entries[i].name);
      }
      break;
    }
    case 'update': {
      // 一键更新: 从 urls.txt 导入新源 + 同步所有源
      const urlsFile = path.join(BASE_DIR, 'urls.txt');
      if (fs.existsSync(urlsFile)) {
        const index = getIndex();
        const existingUrls = new Set((index.urls || []).map(i => i.url));
        const entries = fs.readFileSync(urlsFile, 'utf8').split('\n')
          .map(l => l.trim()).filter(l => l && !l.startsWith('#'))
          .map(l => {
            const hashIdx = l.indexOf('#');
            if (hashIdx > 0) return { url: l.slice(0, hashIdx).trim(), name: l.slice(hashIdx + 1).trim() };
            return { url: l, name: undefined };
          });

        const newEntries = entries.filter(e => !existingUrls.has(e.url));
        if (newEntries.length > 0) {
          console.log(`\n${C.BOLD}📥 发现 ${newEntries.length} 个新源${C.END}`);
          for (const entry of newEntries) {
            await cmdAdd(entry.url, entry.name);
          }
        } else {
          console.log(`\n${C.G}✓ urls.txt 中没有新源${C.END}`);
        }
      }
      // 同步所有源
      await cmdSync();
      // 显示结果
      cmdList();
      break;
    }
    case 'sync': await cmdSync(); break;
    case 'index': cmdIndex(); break;
    case 'list': cmdList(); break;
    default:
      console.log(`TVBox 多仓源管理工具

用法:
  node check_tvbox.js update                   一键更新 (导入新源+同步所有)
  node check_tvbox.js add <url> [-n name]      添加源
  node check_tvbox.js import urls.txt          批量导入
  node check_tvbox.js sync                     同步所有源
  node check_tvbox.js index                    显示多仓内容
  node check_tvbox.js list                     列出已收录的源`);
  }
}

main().catch(console.error);
