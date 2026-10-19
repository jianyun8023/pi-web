# Permission compatibility in the jianyun8023 fork

This fork uses Pi SDK **1.3.0** and preserves the upstream npm package name/version for local installation. `package.json.piWebFork` identifies this build; registry updates are disabled so they cannot silently replace the compatibility changes.

## Review order

`pi-permission-system@41.0.0` can publish `permissions:ready` during its `session_start` before `pi-auto-review@0.27.0` has retained its context. The original reviewer ignores that event and registers only after a subsequent ready event. The patch registers against the public, session-scoped service when reviewer startup completes, or when the actual ready event arrives, whichever is later. Events from other sessions are ignored. Shutdown/reload invalidates a pending review.

If a configured `pi-auto-review` link is missing, an ask is refused with a startup diagnostic. A registered reviewer that returns `defer`, or fails with `failureMode: defer`, still reaches human approval. Deterministic allow/deny rules remain ahead of the authorizer chain.

## RPC path approvals

The reviewer intentionally caps model allows for the `path` and `external_directory` families to `defer`; its original auto-confirm implementation only supports TUI. This fork adds a process-local capability shared by the reviewer and permission terminal. It records a model allow only when `autoConfirmBoundedAllows` enables that family. The terminal consumes it before opening a browser dialog.

The receipt is bound to request ID, complete request/evidence, owning session and surface, expires after ten seconds and is consumed once. Cancellation, shutdown, reload, changed evidence and disabled configuration cannot reuse it. Nothing granting authority crosses the browser/RPC boundary; logs attribute approval to the authorizer, not to a user click. It grants neither session rules nor future tool calls. TUI retains its upstream implementation. Headless operation receives no RPC capability.

`/auto-review-approve` and `/auto-review-break-glass` accept RPC UI as well as TUI. Existing idle checks, exact retry scope, critical confirmation, random typed challenge and expiry remain in place. Local hard-deny rules cannot be overridden.

## Install / verify

Stop idle Pi Web and Pi sessions before replacing extension source. From this checkout:

```sh
npm ci
node bin/pi-web-permissions.js --apply
node bin/pi-web-permissions.js
npm run build
node bin/pi-web.js --hostname 127.0.0.1 --port 30141
```

`--agent-dir /path/to/agent` overrides `PI_CODING_AGENT_DIR` / `~/.pi/agent`. The installer validates **both package versions and all affected source SHA-256 hashes before any write**. Original files receive `.pi-web-original` backups. Unknown versions or local edits in affected files require review; they are never overwritten. Other files, including existing local token estimation changes, are untouched. The launcher refuses unpatched/replaced configured permission plugins.

The source transforms and newly added TypeScript files live here; `manifest.json` pins the npm originals and patched outputs. Tests install the same transforms into isolated copies of the exact npm packages. Plugin reinstall/update may remove the patch: re-run verification, review the new source/version if different, and update the manifest deliberately. No release is published to npm by this task.

For this local build, point the existing global `@agegr/pi-web` package link at the checked-out fork after saving the original package directory. Its `node_modules` and `.next` are the tested local build. Restore the saved directory and original extension files to roll back, then restart the service.

## Validation

```sh
PI_CODING_AGENT_DIR="$(mktemp -d)" npm test
node_modules/.bin/tsc --noEmit
npm run lint
npm run build
```

The tests reproduce the upstream early-registration gap and exercise both registration orders, reload/session isolation, model allow/deny/defer/failure order, exact single-use receipts, manual cancellation/reconnect, RPC recovery commands and a real SDK session writing a temporary marker through both extensions. The model provider is deterministic in regression tests; no real user files are written. Pi 1.3 resolves a bare model ID shared by multiple providers to all matching owners; the model-panel contract test now follows that SDK behavior.
