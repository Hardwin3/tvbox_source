# TVBox 多仓源

自建 TVBox 多仓源，自动检测可用性，备份到本地。

## 使用

在 TVBox 中添加多仓地址：
```
https://tvboxsource.vercel.app/tvboxmuti.json
```

## 结构

```
├── tvboxmuti.json      # 多仓索引 (TVBox 读取这个文件)
├── urls.txt            # 源地址列表 (维护用)
├── _meta.json          # 管理元数据 (不提交到 git)
├── sources/            # 本地备份的 JSON 源文件
│   ├── 玩偶接口/       # 本地化的依赖文件
│   └── 天微七星/
├── check_tvbox.js      # 管理脚本
└── vercel.json         # CORS 配置
```

## 日常维护

### 一键更新（最常用）

编辑 `urls.txt` 添加或替换源地址，然后运行：

```bash
node check_tvbox.js update
```

这会自动：
1. 检测 `urls.txt` 中的新 URL 并导入
2. 同步所有源（检测可用性，更新本地文件）
3. 重新生成 `tvboxmuti.json`

最后推送部署：
```bash
git add . && git commit -m "更新源" && git push
```

### 本地化模式

默认情况下，含依赖文件（jar/js/json）的 JSON 源作为**远程 URL** 使用。

如果需要完全本地化（下载所有依赖文件到 Vercel）：

```bash
node check_tvbox.js update --localize
```

这会额外下载每个源引用的依赖文件（drpy2.min.js、spider.jar、规则 JSON 等），并改写相对路径。

**什么时候用 `--localize`？**
- 原始源地址不稳定，经常挂
- 想要完全自主，不依赖任何外部地址
- 默认模式下某个源无法正常工作

**什么时候不用？**
- 原始源地址稳定可用
- 依赖文件太大（如 jar 包几百 KB）
- 源站拒绝下载（返回 451 错误）

### urls.txt 格式

```
# 注释行以 # 开头
http://宝盒接口.top # 宝盒接口
http://www.饭太硬.net/tv # 饭太硬
https://gitee.com/xxx/xxx.json # 我的源
```

格式：`URL # 名称`（名称可选）

## 源的三种类型

脚本会自动检测每个 URL 返回的内容类型：

| 类型 | 识别方式 | 处理方式 |
|------|---------|---------|
| **多仓** | JSON 含 `urls` 字段 | 展开子源，递归处理 |
| **单仓 JSON** | JSON 含 `sites` 字段 | 保存到本地 / 作为远程 URL |
| **HTML 导航页** | 返回 HTML 页面 | 直接用原始 URL |

## 命令参考

```bash
# 一键更新 (推荐)
node check_tvbox.js update [--localize]

# 添加单个源
node check_tvbox.js add <url> [-n "名称"] [--localize]

# 从 urls.txt 批量导入
node check_tvbox.js import urls.txt [--localize]

# 同步所有源 (检测可用性 + 更新本地文件)
node check_tvbox.js sync [--localize]

# 显示多仓内容
node check_tvbox.js index

# 列出已收录的源
node check_tvbox.js list
```

### 选项

| 选项 | 说明 |
|------|------|
| `--localize`, `-l` | 本地化含依赖的 JSON 源（下载 jar/js/json 等依赖文件） |
| `-n "名称"` | 指定源名称（仅 `add` 命令） |

## 自动同步

GitHub Actions 每天 UTC 3:00（北京时间 11:00）自动运行 `sync`，更新所有源的本地备份。

## Vercel 部署

推送到 GitHub 后 Vercel 自动部署。`vercel.json` 配置了 CORS 头，允许 TVBox 跨域访问。
