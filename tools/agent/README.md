# Agent 运行时（工具调用 / 单 Agent / Harness）

实验6的实现。为「今天吃什么」提供一个**在本地命令行跑通**的单 Agent：模型决定下一步做什么，
程序负责参数校验、权限判定、执行、结果检查与停止控制。

## 为什么是命令行而不是接进 App

一次任务要 3~5 次模型调用，按当前网关的计费口径，走云函数会明显抬高 GBs 用量（项目免费额度 1000 GBs/月）。
Agent 目前定位为**开发态能力**：用来验证「工具 + 循环 + 检查」这条链路本身是否可靠，产物是可复用的模块
（`registry.mjs` / `harness.mjs`），将来接进 App 只需替换 confirm 与日志落点。
App 现有的推荐与问答链路不变。

## 目录

| 文件 | 职责 |
| --- | --- |
| `config.mjs` | 限制值（步数/超时/重试/上下文上限）、密钥读取、路径白名单常量 |
| `schema.mjs` | 4 个工具的 Schema、参数校验器、提示词用的工具清单 |
| `tools.mjs` | 工具实现（筛选 / 详情 / 统计 / 写菜单） |
| `registry.mjs` | 名称白名单、权限策略、参数校验、超时与异常包装、效果预览 |
| `model.mjs` | 模型调用：原生 function calling 优先，网关不支持时回退 JSON 协议；超时与重试 |
| `confirm.mjs` | 人工确认（交互 / 预设 / 非交互拒绝） |
| `logger.mjs` | JSONL 运行日志与脱敏 |
| `harness.mjs` | 循环、上下文组织、停止检查、成功标准校验 |
| `cli.mjs` | 命令行入口（`tools` / `check` / `run`） |
| `suite.mjs` | 8 个用例的测试套件，输出 Markdown 表格；`--only C8` 可单跑一个用例 |
| `fixtures/*.json` | 确定性回放的模型响应序列 |

## 用法

```bash
# 1) 看工具接口与权限
npm run agent:tools

# 2) 不接模型，直接用合法/非法参数打工具（8 条用例）
npm run agent:check

# 3) 跑一次完整任务（会真实调用模型）
npm run agent -- run --goal "两个人晚饭，30 分钟内能做完，口味清淡，不吃虾。挑 2 道菜，算一下总用时，并把菜单存成 dinner-20261027"

# 4) 测试套件（8 个用例，含异常与边界，约 3~5 分钟）

# 5) 只跑某个用例（结果写到 suite-report-C8.json，不覆盖完整报告）
npm run agent:test -- --only C8
npm run agent:test
```

`run` 的常用参数：

| 参数 | 说明 |
| --- | --- |
| `--max-steps <n>` | 最大步数，默认 8；一次模型调用记一步 |
| `--deadline <ms>` | 总时限，默认 150000 |
| `--tool-timeout <ms>` | 单工具超时，默认 3000 |
| `--confirm <yes\|no\|interactive>` | 人工确认应答方式；`interactive` 读终端输入，非 TTY 时默认拒绝 |
| `--script <file>` | 用预置响应序列代替模型（确定性测试） |
| `--fault <tool:throw\|timeout\|write-then-timeout>` | 故障注入；`write-then-timeout` 先写盘再挂起，用于验证超时后的读回核对 |
| `--no-echo` | 不打印逐事件日志 |

## 密钥

`config.mjs` 不存密钥。读取优先级：环境变量 `AI_API_KEY` / `AI_API_URL` / `AI_MODEL`
→ `tools/agent/config.local.js` → `uniCloud-*/cloudfunctions/ragQuery/config.local.js`。
后两者已被 `.gitignore` 的 `**/config.local.js` 覆盖。日志写入前统一脱敏，`sk-` 开头的串会被遮蔽。

## 产物

- 运行日志：`output/agent/runs/<任务编号>.jsonl`（一行一个事件）
- 菜单文件：`output/agent/menus/<menuId>.json`（仅 `save_menu` 可写，且需人工确认）
- 测试结果：`output/agent/suite-report.json`、`output/agent/suite-report.md`

## 已知限制

1. **超时不能强制中断**。工具是进程内同步函数，`Promise.race` 只停止等待。对会写盘的 `save_menu`，
   超时后由 `handleTimeout()` 读回目标文件，比对标题与菜品清单：命中按成功回传（`TOOL_TIMEOUT_RECONCILED`），
   未命中返回 `TOOL_TIMEOUT` 并要求重新确认，不直接重试。C8 用例覆盖这条路径。
   仍未提供幂等键或两阶段提交，若写入被外部程序改动过，核对会判为未命中（保守方向）。
2. **步数是软上限**。一次响应里请求多个工具调用时，只执行前 3 个（`maxToolCallsPerStep`），
   其余返回 `TOOLCALL_LIMIT`，避免用「一次多调」绕过步数限制；但模型仍可能用更少的步数做更多事。
3. **成功标准只覆盖可核验的部分**（菜名/编号可追溯、统计数字与工具一致、文件真实落盘），
   「这份菜单好不好吃」不在检查范围内。
4. **模型对工具异常的处理不稳定**：C3 用例中模型会重试同一工具 1~2 次，能否自行换策略取决于提示词与模型状态。
   程序侧靠「同一工具连续失败 3 次终止」与步数上限兜底。
