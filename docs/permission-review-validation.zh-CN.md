# Pi 权限审核实施与覆盖验证

日期：2026-10-20；macOS、Node 24.11.1、Pi SDK / CLI 1.3.0。功能范围与边界见 [实施设计](permission-review-design.zh-CN.md)。

已完成三仓源码 fork：

- [Pi Web](https://github.com/jianyun8023/pi-web/tree/codex/permission-audit)：审批 RPC、审计桥接/历史/筛选/工具摘要、制品校验及组合回滚。
- [权限引擎](https://github.com/jianyun8023/pi-permission-packages/tree/codex/permission-audit)：请求身份、生命周期、单次终态、会话持久化、RPC 自动批准顺序和 TUI 自动批准来源。
- [模型审核器](https://github.com/jianyun8023/pi-auto-review-packages/tree/codex/permission-audit)：提前注册、ask 语义、无授权效力的环境事实、已有 CJK token 估算迁移、回放案例。

包仍使用上游 identity/version；fork 身份、提交、完整文件和归档 SHA-256 由 [制品清单](../vendor/permission-bundle.json) 固定。没有发布 npm。运行安装指针 `~/.local/share/pi-web-fork/current.json` 记录 Web 提交、完整插件组合及可恢复备份。

## 验证结果

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| 权限引擎完整 Vitest | 6,434 通过，186 文件 | 包含 8 个公开案例等价回归、审计并发/生命周期和 TUI 来源回归 |
| reviewer 完整 Node 测试 | 255 通过，3 跳过 | 跳过的均为 Bun 专用 SQLite/WAL/编译运行项；本机采用 Node |
| Web 完整 Node 测试 | 2,838 通过，1 平台跳过 | 真实打包 fork 消费另运行 39 通过、1 跳过；这些是重叠集合，不相加 |
| 类型检查 | 三包通过 | 权限 public types 构建通过；Web TypeScript、reviewer TypeScript 通过 |
| Web lint / production build | 通过 | 构建仍有原 session export 动态依赖表达式警告，不属于本次权限变更 |
| dotfiles 渲染与幂等 | 11 通过 | 用 uv 运行 Python unittest；包含多主机配置渲染 |
| 配置与真实引擎 | 23 条规则 + 3 条组合命令通过 | 同时验证 bg_run 分派、危险命令在模型前拒绝、模型不可用 defer |
| 组合交付 / 回滚 | 8 项通过 | 同版本篡改、额外源码、重复/路径覆盖、SDK 漂移、归档损坏；部分切换失败和中断恢复 |
| 真实 npm 安装 | 通过 | 独立 agentDir 从两个 tarball 安装，精确 SDK peers，安装后完整性验证 |
| dotfiles setup 消费 | 通过 | 锁定 fork 正常、同版本改源码失败、主 models.json 字节不变 |
| 真实 RPC + SSE | 六种流程通过 | allow / defer / deny / offline / timeout / cancel；细项见下 |
| 真实浏览器 / TUI / 无 UI CLI | 通过 | 浏览器截图、终端审批和会话 JSONL 交叉核验，未仅依赖“完成”回复 |

完整 Web 测试必须设置隔离 `PI_CODING_AGENT_DIR`。曾漏设导致模型发现测试尝试创建真实 auth lock，被 sandbox 拒绝；改用隔离目录重跑全部通过，没有获取写真实凭据的权限。

## 行为覆盖矩阵

| 能力 | 确定性 / 故障注入证据 | 真实运行证据 |
| --- | --- | --- |
| 规则优先、组合 deny | 完整引擎测试；敏感路径/重定向/链式命令正反例；hard deny 零模型调用 | dotfiles 配置加载真实实现，代表命令只解析不执行 |
| 自动审核先于人工 | 两种注册顺序、缺失 reviewer、allow/defer/deny；RPC receipt 的请求/参数/会话/有效期绑定 | SSE 的 reviewed 先于 select；allow 和 deny 不出现 select |
| 失败降级 | unavailable / timeout / no UI / 错误处理测试 | provider 故障和超时后才询问；无 UI CLI 拒绝，toolResult.isError=true |
| 手动决定 | confirm/select/input、精确重试、break-glass challenge 回归 | Web Yes、No；TUI Enter 允许、Esc 拒绝；TUI 自动确认记 reviewer |
| 重连/重复响应 | 快照去重、旧 phase 不覆盖终态、reload 代次隔离 | SSE 重连同一 pending id、等待审计重放、两次并发及一次迟到响应只完成一次 |
| 取消/迟到结果 | 审核取消、reload/shutdown、receipt 失效与下一请求可用 | 中止实际审核后没有审批弹窗、最终拒绝 |
| 工具链/子工具/子会话 | AsyncLocalStorage 并发、parentToolCallId、requester/adjudicator 双身份、转发原有回归 | 普通 SDK 工具真实临时写入；子会话审计归属以自动化测试为证据，未运行多 agent UI 场景 |
| 历史/分支/恢复 | abandoned branch 排除、继承原身份、pending 历史为 unknown、3,000 phase 归并 1,000 请求 | 刷新恢复、reload 后历史 generation 不变、真实 session context 返回历史 |
| 持久化/数据边界 | appendEntry 失败注入、脱敏/限长/未知字段剔除、恶意 JSON 不触发 coercion | 真实 SDK 的 custom 条目在原始会话存在，model projection 与聊天消息不包含它 |
| 安装/整体恢复 | 同版本覆盖检测、归档损坏前零变更、事务中途失败和备份后中断恢复、重复 rollback | 真实 npm 安装及完整文件校验；本机部署指针/备份另记录 |

审计记录只说明权限决定。工具执行成功与失败仍来自 tool result。TUI 沿用原生自动确认拦截器，可能经过瞬时 dialog 阶段，最终来源为 reviewer；Web/RPC 的一次性 receipt 在广播人工 UI 前消费。

## 公开案例验证

1. [Claude Code #91650](https://github.com/anthropics/claude-code/issues/91650) 报告 `cd`、相对路径读取、分号/管道与敏感 Read deny 组合导致不必要审批。将命令结构转成 Pi 等价 fixture：三条正常源码读取允许、五条 `.env` / 多文件 / 输出重定向拒绝，8/8 通过。没有执行 Claude 二进制，也没有声称复现 Windows 平台实现。
2. [pi-auto-reviewer 的分层处理](https://github.com/vinzenzu/pi-auto-reviewer#how-it-works) 用于评估简单读取快速处理、复杂命令保守审查的设计。实现复用 Pi 的 AST、路径与组合策略，不额外复制正则白名单；危险链式命令不会因前一段安全而放行。
3. [Pi SDK 1.3.0 会话格式](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/docs/session-format.md) 和扩展机制用于确认 custom audit 与模型消息分离。增加真实 SDK 测试验证，而不只测试自写转换器。

对应公开案例测试位于权限仓 `test/handlers/gates/public-case-regressions.test.ts`；本地 21 案例位于 reviewer 仓 `test/fixtures/local-review-cases.json`。

## 真实模型回放

使用现有 `magpie/codex/gpt-6-luna`。输入为 21 条去标识案例与重构的用户意图；只送审核，不执行案例命令、不发送原始会话日志或凭据。

总计 51 次审核流程回放，其中 6 次输入过长在调用模型前 defer，实际模型请求 45 次。结果保存在 [回放数据](evidence/model-replay.json)。

| 集合 | 允许 | defer | 错误 |
| --- | --- | --- | --- |
| 新版全部 21 案例各一次 + 历史 6 defer 案例额外各两次（33 次） | 28 | 5 | 0 |
| 同一组历史 6 defer 案例，新版各三次（18 次） | 15 | 3 | 0 |
| 同一组历史 6 defer 案例，旧版各三次（18 次） | 14 | 4 | 0 |

历史案例 04 的完整命令被截断，新旧都保持 defer；其他五条窄只读案例新版均允许。全部 21 案例中的 02（较宽 dotfiles 读取）、19（日志统计与源码范围）仍发生 defer，记录为未达到预期自动放行，未通过放宽危险规则强行消除。

新版实际模型调用 p50/p95 为 1,890/3,199 ms；旧版为 2,140/8,740 ms。两套完整样本分布不同且数量小，不能据此宣称稳定性能提升；公平的六案例比较仅多放行 1 次。此次回放未保存可用 token/费用数据，不估算费用，也不把累计模型时间当墙钟收益。

## 复现

```sh
# Web
PI_CODING_AGENT_DIR=/tmp/pi-web-empty-agent npm test
PI_PERMISSION_TEST_FORK=1 node --experimental-strip-types --test lib/permission-review-compat.test.mjs lib/permission-audit.test.mjs lib/permission-fork-bundle.test.mjs lib/permission-release-state.test.mjs
node_modules/.bin/tsc --noEmit
npm run lint
npm run build

# 使用尚不存在的 /tmp 路径创建真实 npm 安装与确定性 provider
node scripts/prepare-permission-fixture.mjs /tmp/pi-permission-fixture
PI_CODING_AGENT_DIR=/tmp/pi-permission-fixture node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 30142
# 另一终端，六种场景只写 fixture 目录
node scripts/verify-permission-runtime.mjs http://127.0.0.1:30142 /tmp/pi-permission-fixture/workspace

# 权限包目录
pnpm test
pnpm check
pnpm run build:types
# reviewer 包目录
npm test
npm run check
# dotfiles 仓
uv run --no-project python -m unittest discover -s tests -p test_ai_dotfiles.py
```

模型回放脚本 `scripts/replay-permission-cases.mjs` 需要现有本机 provider 凭据，会产生模型调用；不属于默认单测。真实审批截图见 [Web 验收图](evidence/permission-web.png)。

## 交付与边界

部署使用独立 release，等待无运行/待审批会话后切换。整个 npm 树、两份运行配置、setup/tools、相关 dotfiles 源文件、全局链接与 current.json 作为一个事务备份；`transaction.json` 可恢复半完成切换，备份中的 `rollback.cjs` 恢复并重启旧版本。主模型、models.json 和 auth.json 不改动。

覆盖是行为矩阵，不是全仓行覆盖率声明。未实测 Bun、Windows/Linux UI、真实磁盘耗尽/断电、超长会话服务器分页或任意扩展内部网络访问；写盘失败和进程中断以故障注入/持久历史 fixture 验证。UI 当前按完整活跃分支归并后每页 30 项，没有服务器分页。插件实现工具权限审核，不能替代操作系统或网络沙箱。
