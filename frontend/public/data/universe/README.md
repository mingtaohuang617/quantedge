# universe data (static)

这里放 `universe_us.json` / `universe_cn.json` / `universe_hk.json`，作为 vercel
production 部署的静态资源。

`/api/watchlist/10x/screen` serverless function 通过 self-fetch 这些文件做候选筛选。

## 上线步骤

```bash
# 1. 在本地拉数据（带 enrich）
python -m backend.universe.sync_us --enrich
python -m backend.universe.sync_cn --enrich
python -m backend.universe.sync_hk --enrich

# 2. 复制到这里
python backend/export_universe_to_frontend.py

# 3. commit + push（vercel 自动部署）
git add frontend/public/data/universe/
git commit -m "data: refresh universe"
git push
```

刷新频率取决于你的策略，建议每月跑一次（标的和市值变化不会太剧烈）。
