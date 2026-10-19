# Local validation — 2026-10-19

- Pi SDK: all seven packages pinned to 1.3.0; permission system 41.0.0, reviewer 0.27.0.
- Full suite: 2,822 tests, **2,821 passed**, zero failures; one Windows junction test skipped on macOS. Command: `PI_CODING_AGENT_DIR=/tmp/pi-web-suite-agent npm test` (isolated credentials/config).
- Permission regressions: 23 passed, including original registration-race reproduction, both ready/start orders, cross-session isolation, reload, late results after explicit cancellation, model allow/deny/defer/offline behavior, expiring one-use RPC receipts, reconnect/cancel, exact-retry and critical typed challenge, and an actual SDK session writing a temporary marker through both extensions.
- `node_modules/.bin/tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm run build`: passed, isolated checkout with no development server.
- Production browser fixture at loopback port 30142: actual Web UI + SDK + patched extensions, deterministic provider with an 800 ms review delay. Allow wrote `allow.txt` without a human dialog; defer showed separate path/tool asks only after review and wrote `defer.txt` only after human choices; deny showed authorizer refusal, no approval dialog, and did not create `deny.txt`. All files confined to `/tmp/pi-web-browser-agent/workspace`.
- Real configured model transport, synthetic review only: `magpie/codex/gpt-6-luna` returned allow/medium in 4,271 ms, one attempt. The represented shell command was not executed.
- Actual installation preserves the existing local `src/review/input.ts` token-estimation modification and user model settings. Source files changed by the compatibility installer are listed with original/patched SHA-256 hashes in `manifest.json`.

Deterministic tests do not prove model decision accuracy on arbitrary real workloads. Existing live CLI sessions need `/reload` or restart to load changed extension source; no unrelated CLI session is interrupted by deployment.

Installation smoke: dedicated release `de36680` is active at `http://127.0.0.1:30141`. Page and model discovery returned 200 (65 models); the existing `magpie/group/kimi-k2.8` default remained selected. A real-config RPC session loaded all three auto-review commands and was deleted successfully after inspection. No running or pending-approval sessions remained. The original token estimator SHA-256 was identical before and after deployment. The old npm package directory and affected extension sources are retained in the timestamped backup recorded by `~/.local/share/pi-web-fork/current.json`.
