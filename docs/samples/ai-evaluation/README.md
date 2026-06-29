# 文本 AI 黄金评测集

本目录保存阶段 3A 的机器可读黄金样本。原始描述来自 `docs/samples/batch-001.md`，不在评测文件中改写；`golden_id` 仅用于评测关系，不是业务数据库 ID。

## 指标

- 记录精确率/召回率：候选与同类型黄金记录的 `match` 字段全部相等才算匹配。
- 金额准确率：匹配记录中的 `amount_minor`、`order_total_minor` 必须按分精确相等。
- 关系正确率：两端候选均匹配黄金记录且关系类型一致。
- explicit 纯度：未匹配候选或黄金确定性非 explicit 的候选不得标为 explicit。

通过门槛：精确率与召回率均不低于 90%，金额 100%，关系不低于 90%，explicit 误标为 0。

真实 API 评测必须显式执行，不进入普通测试：

```powershell
cd backend
python scripts/evaluate_ai.py --provider deepseek --output evaluation-deepseek.json
python scripts/evaluate_ai.py --provider mimo --output evaluation-mimo.json
```

API Key 优先读取 `DEEPSEEK_API_KEY` / `MIMO_API_KEY`；否则读取本地 `secrets.json`。输出文件包含模型、Prompt 版本、逐样本差异和汇总指标，不应提交真实响应中可能包含的敏感文本。
