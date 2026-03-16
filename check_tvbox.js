#!/usr/bin/env node
/**
 * TVBox 多仓源管理工具 (Node.js 版)
 *
 * 逻辑:
 *   源 URL → 请求数据
 *     ├── 能解析为 JSON (含 sites 或 storeHouse) → 存本地文件 → 多仓指向本地
 *     ├── HTML 页面 / 无法解析 → 存 URL → 多仓指向原始 URL (让 TVBox 处理)
 *     └── 完全无响应 → 标记为不可用
 *
 * 用法:
 *   node check_tvbox.js add <url> [-n name]   添加源
 *   node check_tvbox.js import urls.txt        批量导入
 *   node check_tvbox.js sync                   同步所有源（重新获取）
 *   node check_tvbox.js index                  生成多仓索引文件
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
// Vercel 部署地址（本地文件通过此 URL 提供访问）
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
 * 获取源数据，返回:
 *   { type: 'json', data: {...} }         - 直接是 JSON
 *   { type: 'multi', data: {...} }        - 是多仓 JSON
 *   { type: 'url', detail: '...' }        - 不是 JSON，让 TVBox 自己处理
 *   null                                  - 完全无法访问
 */
async function fetchSource(url) {
  const result = await fetchRaw(url);
  if (!result) return null;
  if (result.status >= 400) return null;

  const raw = result.data;

  // 尝试直接解析 JSON
  try {
    const json = JSON.parse(raw);
    if (json.storeHouse) return { type: 'multi', data: json };
    if (json.sites) return { type: 'json', data: json };
    // JSON 但格式未知
    return { type: 'url', detail: 'JSON 但无 sites/storeHouse' };
  } catch {}

  // 是 HTML → TVBox APP 可以自己解析导航页
  if (raw.includes('<html') || raw.includes('<!DOCTYPE') || raw.includes('<head')) {
    return { type: 'url', detail: 'HTML 导航页' };
  }

  // 二进制数据（可能是藏了 JSON 的图片）
  const b64 = raw.match(/[A-Za-z0-9+\/]{200,}={0,2}/g);
  if (b64) {
    for (const m of b64) {
      try {
        const d = Buffer.from(m, 'base64').toString('utf8');
        if (d.includes('"sites"')) return { type: 'url', detail: '嵌入式 JSON (需 APP 解析)' };
      } catch {}
    }
  }

  return { type: 'url', detail: '未知格式' };
}

// ============ 索引管理 ============
// 用 tvboxmuti.json 作为唯一的数据文件
// TVBox 只读 sourceName + sourceUrl，其余字段是管理用的元数据
function getIndex() {
  // 优先读 _meta.json（含管理元数据），没有则读 tvboxmuti.json
  const metaFile = path.join(BASE_DIR, '_meta.json');
  if (fs.existsSync(metaFile)) try { return JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch {}
  if (fs.existsSync(INDEX_FILE)) try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch {}
  return { storeHouse: [] };
}
function saveIndex(index) {
  // 生成给 TVBox 用的干净版本（只有 sourceName + sourceUrl）
  const tvboxFormat = {
    storeHouse: index.storeHouse.map(item => ({
      sourceName: item.sourceName,
      sourceUrl: item.sourceType === 'local' && item.localFile
        ? `${BASE_URL}/sources/${item.localFile}`
        : item.sourceUrl
    }))
  };
  fs.writeFileSync(INDEX_FILE, JSON.stringify(tvboxFormat, null, 2), 'utf8');

  // 管理元数据存到 _meta.json
  const metaFile = path.join(BASE_DIR, '_meta.json');
  fs.writeFileSync(metaFile, JSON.stringify(index, null, 2), 'utf8');
}

// ============ 核心: 添加源 ============
async function cmdAdd(url, name) {
  ensureDir(SOURCES_DIR);
  console.log(`${C.BOLD}处理: ${url}${C.END}`);

  const result = await fetchSource(url);
  if (!result) { log('fail', '无法访问'); return false; }

  let sourceName = name;
  if (!sourceName) {
    try {
      const u = new URL(url);
      // 解码 URL 编码的中文路径
      sourceName = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      sourceName = sourceName.replace('.json', '') || u.hostname;
    } catch {
      sourceName = urlToId(url);
    }
  }
  const index = getIndex();

  // 检查是否已存在
  if (index.storeHouse.some(i => i.sourceUrl === url)) {
    log('warn', `已存在: ${sourceName}`);
    return true;
  }

  if (result.type === 'multi') {
    // 多仓 → 递归处理每个子源
    log('info', `多仓源, ${result.data.storeHouse.length} 个子源`);
    for (const entry of result.data.storeHouse) {
      const childUrl = entry.sourceUrl || entry.url;
      const childName = entry.sourceName || entry.name || '未命名';
      if (childUrl) await cmdAdd(childUrl, childName);
    }
    return true;
  }

  if (result.type === 'json') {
    // 单仓 JSON → 存本地文件
    const fname = `${safeName(sourceName)}_${urlToId(url)}.json`;
    fs.writeFileSync(path.join(SOURCES_DIR, fname), JSON.stringify(result.data, null, 2), 'utf8');
    const siteCount = result.data.sites?.length || 0;
    log('ok', `${sourceName} → 本地文件 (${siteCount} 站点)`);
    index.storeHouse.push({
      sourceName, sourceUrl: url, localFile: fname,
      sourceType: 'local', siteCount,
      addTime: new Date().toISOString()
    });
  } else {
    // 非 JSON → 直接存 URL，让 TVBox APP 处理
    log('url', `${sourceName} → 直接使用 URL (${result.detail})`);
    index.storeHouse.push({
      sourceName, sourceUrl: url, localFile: null,
      sourceType: 'remote', detail: result.detail,
      addTime: new Date().toISOString()
    });
  }

  saveIndex(index);
  return true;
}

// ============ 同步（重新获取所有源）============
async function cmdSync() {
  const index = getIndex();
  if (!index.storeHouse.length) { log('info', '索引为空'); return; }

  console.log(`\n${C.BOLD}同步 ${index.storeHouse.length} 个源${C.END}`);
  console.log('='.repeat(60));

  const newIndex = { storeHouse: [] };
  for (const item of index.storeHouse) {
    console.log(`\n${C.BOLD}${item.sourceName}${C.END}: ${item.sourceUrl}`);
    const result = await fetchSource(item.sourceUrl);

    if (!result) {
      log('fail', '无法访问, 跳过');
      // 保留原记录但标记失效
      newIndex.storeHouse.push({ ...item, status: 'unreachable' });
      continue;
    }

    if (result.type === 'json') {
      const fname = item.localFile || `${safeName(item.sourceName)}_${urlToId(item.sourceUrl)}.json`;
      fs.writeFileSync(path.join(SOURCES_DIR, fname), JSON.stringify(result.data, null, 2), 'utf8');
      const siteCount = result.data.sites?.length || 0;
      log('ok', `本地文件已更新 (${siteCount} 站点)`);
      newIndex.storeHouse.push({
        ...item, localFile: fname, sourceType: 'local',
        siteCount, lastSync: new Date().toISOString()
      });
    } else {
      log('url', `远程 URL (${result.detail})`);
      newIndex.storeHouse.push({
        ...item, sourceType: 'remote',
        detail: result.detail, lastSync: new Date().toISOString()
      });
    }
  }

  saveIndex(newIndex);
  console.log(`\n${C.G}同步完成${C.END}\n`);
}

// ============ 显示多仓文件内容 ============
function cmdIndex() {
  const index = getIndex();
  if (!index.storeHouse.length) { log('info', '索引为空'); return; }

  console.log(`\n${C.BOLD}tvboxmuti.json 内容 (${index.storeHouse.length} 个源)${C.END}`);
  console.log('='.repeat(60));

  for (const item of index.storeHouse) {
    const url = item.sourceType === 'local' && item.localFile
      ? `sources/${item.localFile}`
      : item.sourceUrl;
    const type = item.sourceType === 'local' ? `(${item.siteCount || '?'}站)` : '(远程)';
    log(item.sourceType === 'local' ? 'info' : 'url',
        `${item.sourceName} → ${url} ${type}`);
  }
  console.log();
}

// ============ 列出源 ============
function cmdList() {
  const index = getIndex();
  if (!index.storeHouse.length) { log('info', '暂无收录的源'); return; }
  console.log(`\n${C.BOLD}已收录 ${index.storeHouse.length} 个源:${C.END}`);
  console.log('='.repeat(60));
  index.storeHouse.forEach((item, i) => {
    const type = item.sourceType === 'local' ? `[本地 ${item.siteCount || '?'}站]` : '[远程]';
    const status = item.status === 'unreachable' ? ` ${C.R}(失效)${C.END}` : '';
    console.log(`  ${i + 1}. ${C.BOLD}${item.sourceName}${C.END} ${type}${status}`);
    console.log(`     ${C.D}${item.sourceUrl}${C.END}`);
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
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'))
        .map(l => {
          const hashIdx = l.indexOf('#');
          if (hashIdx > 0) {
            return { url: l.slice(0, hashIdx).trim(), name: l.slice(hashIdx + 1).trim() };
          }
          return { url: l, name: undefined };
        });
      log('info', `共 ${entries.length} 个 URL`);
      for (let i = 0; i < entries.length; i++) {
        console.log(`\n${C.BOLD}[${i + 1}/${entries.length}]${C.END}`);
        await cmdAdd(entries[i].url, entries[i].name);
      }
      break;
    }
    case 'sync':
      await cmdSync();
      break;
    case 'index':
      cmdIndex();
      break;
    case 'list':
      cmdList();
      break;
    default:
      console.log(`TVBox 多仓源管理工具

用法:
  node check_tvbox.js add <url> [-n name]   添加源
  node check_tvbox.js import urls.txt        批量导入
  node check_tvbox.js sync                   同步所有源
  node check_tvbox.js index                  生成多仓索引
  node check_tvbox.js list                   列出已收录的源`);
  }
}

main().catch(console.error);
