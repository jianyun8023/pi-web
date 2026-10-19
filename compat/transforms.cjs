/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error('Patch anchor is missing or ambiguous');
  return text.replace(before, after);
}
module.exports = {
  '@erichll/pi-auto-review': {
    'src/index.ts': input => {
      let s = replaceOnce(input, 'import { PermissionUiAutoConfirmer } from "./ui-auto-confirm.ts";', 'import { PermissionUiAutoConfirmer } from "./ui-auto-confirm.ts";\nimport { PermissionRpcAutoConfirmer } from "./rpc-auto-confirm.ts";');
      s = replaceOnce(s, '  const reviewWidget = new UserReviewWidgetController();', '  const rpcAutoConfirmer = new PermissionRpcAutoConfirmer(\n    () => config.autoConfirmBoundedAllows,\n  );\n  const reviewWidget = new UserReviewWidgetController();');
      s = s.replaceAll('!ctx.hasUI || ctx.mode !== "tui"', '!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")');
      s = s.replaceAll('requires interactive TUI mode.', 'requires interactive TUI or RPC UI.');
      s = replaceOnce(s, '    uiAutoConfirmer.clear();\n    try {', '    uiAutoConfirmer.clear();\n    rpcAutoConfirmer.clear();\n    try {');
      s = replaceOnce(s, '      policyAudit.warmup();', '      policyAudit.warmup();\n      rpcAutoConfirmer.attach(ctx);');
      s = replaceOnce(s, '        disposeBrokerService = undefined;\n      }\n    } catch (error) {', '        disposeBrokerService = undefined;\n      }\n      // A session_start ready event may precede this reviewer\'s context.\n      // Register now if the service already exists; otherwise its real ready\n      // event will register us. This also covers pre-before_agent_start asks.\n      const sessionId = ctx.sessionManager.getSessionId();\n      if (getPermissionsService(sessionId)) registerPermissionAuthorizer({ sessionId });\n    } catch (error) {');
      s = replaceOnce(s, '      context = undefined;\n      broker = undefined;', '      rpcAutoConfirmer.clear();\n      context = undefined;\n      broker = undefined;');
      s = replaceOnce(s, '      uiAutoConfirmer.clear();\n    }\n  });', '      uiAutoConfirmer.clear();\n      rpcAutoConfirmer.revoke();\n    }\n  });');
      s = replaceOnce(s, '  pi.events.on("permissions:ready", (event) => {', '  function registerPermissionAuthorizer(event: unknown): void {');
      s = replaceOnce(s, '            reviewContext.mode === "tui" &&\n            reviewContext.hasUI &&\n            uiAutoConfirmer.stage(request.id, surface);', '            reviewContext.hasUI &&\n            (reviewContext.mode === "tui"\n              ? uiAutoConfirmer.stage(request.id, surface)\n              : reviewContext.mode === "rpc"\n                && rpcAutoConfirmer.stage(request.id, surface, details.payload));');
      s = replaceOnce(s, '  });\n\n  pi.on("session_shutdown", async () => {', '  }\n  pi.events.on("permissions:ready", registerPermissionAuthorizer);\n\n  pi.on("session_shutdown", async () => {');
      s = replaceOnce(s, '    uiAutoConfirmer.clear();\n    context = undefined;', '    uiAutoConfirmer.clear();\n    rpcAutoConfirmer.clear();\n    context = undefined;');
      s = replaceOnce(s, '    if (registeredSessionId === sessionId && disposeAuthorizer) return;', '    if (!context || context.sessionManager.getSessionId() !== sessionId) return;\n    if (registeredSessionId === sessionId && disposeAuthorizer) return;');
      s = replaceOnce(s, '  let registrationEpoch = 0;', '  let registrationEpoch = 0;\n  let reviewGeneration = 0;');
      s = replaceOnce(s, '      uiAutoConfirmer.clear();\n      rpcAutoConfirmer.revoke();', '      reviewGeneration++;\n      uiAutoConfirmer.clear();\n      rpcAutoConfirmer.revoke();');
      s = replaceOnce(s, '          const decision = await broker.review(request, {', '          const generation = reviewGeneration;\n          const decision = await broker.review(request, {');
      s = replaceOnce(s, '          const result = reviewResults.get(request.id);', '          if (shuttingDown || context !== reviewContext || epoch !== registrationEpoch || generation !== reviewGeneration || reviewContext.signal?.aborted) {\n            reviewResults.delete(request.id);\n            return { kind: "deny", reason: "Review was cancelled by session shutdown or reload." };\n          }\n          const result = reviewResults.get(request.id);');
      return s;
    },
    'src/rpc-auto-confirm.ts': () => fs.readFileSync(path.join(__dirname, 'rpc-auto-confirm.ts.txt'), 'utf8'),
  },
  '@gotgenes/pi-permission-system': {
    'src/authority/local-user-authorizer.ts': input => replaceOnce(input, '      buildRequestOptions(details),\n    );', '      buildRequestOptions(details),\n      details.requestId,\n    );'),
    'src/authority/permission-prompt-component.ts': input => {
      let s = replaceOnce(input, 'import type {\n  ExtensionContext,', 'import { consumeRpcReviewedApproval } from "./rpc-reviewed-approval";\nimport type {\n  ExtensionContext,');
      s = replaceOnce(s, '  options?: RequestPermissionOptions,\n): Promise<PermissionPromptDecision> {\n  const window', '  options?: RequestPermissionOptions,\n  requestId?: string,\n): Promise<PermissionPromptDecision> {\n  // The deterministic gate and model already ruled on this exact request.\n  // Keep machine provenance; no browser answer or session-wide grant is minted.\n  if (view.mode === "rpc" && consumeRpcReviewedApproval(view.ui, requestId, payload)) {\n    return {\n      approved: true,\n      state: "approved",\n      decidedBy: { kind: "authorizer", name: "pi-auto-review", verdict: "allow", reason: null },\n    };\n  }\n  const window');
      return s;
    },
    'src/authority/rpc-reviewed-approval.ts': () => fs.readFileSync(path.join(__dirname, 'rpc-reviewed-approval.ts.txt'), 'utf8'),
  },
};
// An absent configured reviewer is a startup failure, not a human review.
module.exports['@gotgenes/pi-permission-system']['src/authority/authorizer-selection.ts'] = input => replaceOnce(input,
  '        this.deps.chainAudit.auditUnregisteredLink({ requestId, name });\n        continue;',
  '        this.deps.chainAudit.auditUnregisteredLink({ requestId, name });\n        if (name === "pi-auto-review") {\n          links.push({\n            name,\n            authorize: async () => ({\n              kind: "deny",\n              reason: "The configured automatic reviewer is not ready. No operation was executed. Reload the session after fixing the reviewer startup error.",\n            }),\n          });\n        }\n        continue;');
