# TVBox 多仓源

自建 TVBox 多仓源，自动检测可用性，备份到本地。

## 使用

在 TVBox 中添加多仓地址：
```
https://tvbox-source.vercel.app/tvboxmuti.json
```

## 结构

- `tvboxmuti.json` — 多仓索引
- `sources/` — 本地备份的 JSON 源
- `check_tvbox.js` — 检测管理脚本

## 管理

```bash
# 添加源
node check_tvbox.js add <url> -n "名称"

# 批量导入
node check_tvbox.js import urls.txt

# 同步所有源
node check_tvbox.js sync

# 列出已收录的源
node check_tvbox.js list
```
