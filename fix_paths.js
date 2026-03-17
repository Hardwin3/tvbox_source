#!/usr/bin/env node
/**
 * 更新源 JSON 文件中的相对路径，加上子目录前缀
 * 使从 Vercel 的 /sources/ 访问时能正确解析依赖文件
 */

const fs = require('fs');
const path = require('path');

const BASE_DIR = __dirname;
const SOURCES_DIR = path.join(BASE_DIR, 'sources');

function fixPaths(filePath, prefix) {
  let content = fs.readFileSync(filePath, 'utf8');

  // 匹配所有 "./ 开头的路径（不包含 http/https）
  // 例如: "./lib/drpy2.min.js" → "./玩偶接口/lib/drpy2.min.js"
  // 注意: 有些路径末尾带 ? 如 "./json/wogg.json?"
  content = content.replace(/"\.\/([^"]+)"/g, (match, p1) => {
    // 跳过已经是绝对 URL 的情况（不应该出现，但保险起见）
    if (p1.startsWith('http')) return match;
    // 跳过已经在子目录中的（防止重复替换）
    if (p1.startsWith(prefix)) return match;
    return `"./${prefix}/${p1}"`;
  });

  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✓ 已更新: ${path.basename(filePath)}`);
}

// 修复 玩偶接口
const wanguFile = path.join(SOURCES_DIR, '玩偶接口_7aa2b4cb.json');
fixPaths(wanguFile, '玩偶接口');

// 修复 天微七星
const twqxFile = path.join(SOURCES_DIR, '天微七星_5595e661.json');
fixPaths(twqxFile, '天微七星');

console.log('\n完成！现在相对路径都会指向对应的子目录。');
