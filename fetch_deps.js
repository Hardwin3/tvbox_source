#!/usr/bin/env node
/**
 * 从原始源地址下载所有依赖文件到 sources/ 目录
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_DIR = __dirname;
const SOURCES_DIR = path.join(BASE_DIR, 'sources');
const TIMEOUT = 30000;

function fetchFile(url, timeout = TIMEOUT, maxRedirects = 5) {
  return new Promise((resolve) => {
    let redirects = 0;
    const go = (u) => {
      if (redirects >= maxRedirects) return resolve(null);
      const mod = u.startsWith('https') ? https : http;
      const timer = setTimeout(() => { console.log(`  ⏱ 超时`); resolve(null); }, timeout);
      const req = mod.get(u, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout
      }, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          clearTimeout(timer); redirects++;
          return go(new URL(res.headers.location, u).href);
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => { clearTimeout(timer); resolve({ status: res.statusCode, data: Buffer.concat(chunks) }); });
      });
      req.on('error', (e) => { clearTimeout(timer); console.log(`  ✗ ${e.message}`); resolve(null); });
      req.on('timeout', () => { req.destroy(); clearTimeout(timer); resolve(null); });
    };
    go(url);
  });
}

const sources = [
  {
    name: '玩偶接口',
    baseUrl: 'https://gitee.com/blssss/jk/raw/api/',
    files: [
      // jar 包
      'XBQH.jar',
      'lib/ali.jar',
      'lib/tudou.jar',
      // JS 引擎
      'lib/drpy2.min.js',
      // 站点 JS
      'lib/douban.js', 'lib/iqytv.js', 'lib/live2mv.js', 'lib/lyyytv.js',
      'lib/mgtv.js', 'lib/sogou.js', 'lib/tvbox29.js', 'lib/txtv.js',
      'lib/yktv.js', 'lib/哔哩直播.js', 'lib/好看.js', 'lib/好趣网.js',
      'lib/急救.json', 'lib/我的哔哩.js', 'lib/斗鱼直播.js',
      'lib/有声小说吧.json', 'lib/武享吧.js', 'lib/电影天堂.json',
      'lib/电影港.json', 'lib/盘搜.json', 'lib/相声随身听.json',
      'lib/童趣.json', 'lib/素白白.json', 'lib/网飞.js',
      'lib/聚合网盘.json', 'lib/虎牙直播.js', 'lib/蜻蜓FM.js',
      'lib/评书.json', 'lib/酷6网.js', 'lib/酷奇MV.js',
      'lib/音范丝.json', 'lib/黑狐影视.json',
      // XBPQ 站点 JSON
      'lib/zeqaht.json', 'lib/baipiaoys.json', 'lib/4kvm.json',
      'lib/南坊.json', 'lib/heimuer.json', 'lib/2bt.json',
      'lib/365.js', 'lib/98影视.json', 'lib/A8音乐.js',
      'lib/DJ呦呦.json', 'lib/dm84.json', 'lib/兔小贝.json',
      'lib/土豆.json', 'lib/wo4K.json', 'lib/wog1.json',
      'lib/wog2.json', 'lib/wog3.json', 'lib/wog4.json',
      'lib/wog5.json', 'lib/wog6.json', 'lib/wog7.json',
      'lib/yunpan.json', 'lib/zb.json', 'lib/影搜.json',
    ]
  },
  {
    name: '天微七星',
    baseUrl: 'http://7337.kstore.space/qxys/',
    files: [
      'qxyc.jar',
      'json/哔哩视频.json', 'json/哔哩合集.json', 'json/xbky.json',
      'json/wogg.json', 'json/mogg.json', 'json/lb.json',
      'json/sd.json', 'json/ex.json', 'json/zz.json',
      'json/123.json', 'json/lj.json',
      'json/哔哩哔哩相声.json', 'json/哔哩哔哩小品.json', 'json/哔哩哔哩戏曲.json',
      'js/drpy2.min.js', 'js/jrk.js',
      'js/呦呦DJ.js', 'js/清风DJ.js', 'js/爱车MV.js', 'js/酷奇MV.js',
      'lib/88看球.js', 'lib/310直播.js', 'lib/360吧.js',
      'py/金牌影视.py',
      'XYQHiker/农民影视.json',
    ]
  }
];

async function main() {
  let totalOk = 0, totalFail = 0;

  for (const source of sources) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📦 ${source.name} — ${source.baseUrl}`);
    console.log(`${'='.repeat(60)}`);

    for (const relPath of source.files) {
      const url = source.baseUrl + relPath;
      const localFile = path.join(SOURCES_DIR, source.name, relPath);
      const localDir = path.dirname(localFile);

      // 跳过已下载的文件
      if (fs.existsSync(localFile)) {
        console.log(`  ⊘ 跳过 (已存在): ${relPath}`);
        continue;
      }

      console.log(`\n⬇ ${relPath}`);
      const result = await fetchFile(url);
      if (!result || result.status >= 400) {
        console.log(`  ✗ 失败 (status: ${result ? result.status : 'null'})`);
        totalFail++;
        continue;
      }

      fs.mkdirSync(localDir, { recursive: true });
      const ext = path.extname(relPath).toLowerCase();
      if (['.jar', '.so', '.dex', '.zip'].includes(ext)) {
        fs.writeFileSync(localFile, result.data);
      } else {
        fs.writeFileSync(localFile, result.data.toString('utf8'), 'utf8');
      }

      console.log(`  ✓ ${(result.data.length / 1024).toFixed(1)} KB`);
      totalOk++;
    }
  }

  console.log(`\n完成: ${totalOk} 新增, ${totalFail} 失败`);
}

main().catch(console.error);
