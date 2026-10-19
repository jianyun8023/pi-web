import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("..", import.meta.url));
const { applyPermissionCompatibility, inspectPermissionCompatibility } = require("../bin/pi-web-permissions.js");
const packages = ["@erichll/pi-auto-review", "@gotgenes/pi-permission-system"];
const fixture = mkdtempSync(join(tmpdir(), "pi-web-permission-compat-"));
const packageRoot = (name) => join(fixture, "npm", "node_modules", name);
const fork = process.env.PI_PERMISSION_TEST_FORK === "1";
const bundle = fork ? JSON.parse(readFileSync(join(root, "vendor/permission-bundle.json"), "utf8")) : null;
for (const name of packages) {
  const source = join(root, "node_modules", name === "@gotgenes/pi-permission-system" ? "pi-permission-system-upstream" : name);
  mkdirSync(dirname(packageRoot(name)), { recursive: true });
  if (fork) { mkdirSync(packageRoot(name), {recursive:true}); execFileSync("tar", ["-xzf", join(root, bundle.packages[name].archive), "-C", packageRoot(name), "--strip-components=1"]); }
  else cpSync(source, packageRoot(name), { recursive: true, filter: (path) => !path.includes(`${name}/node_modules`) });
  symlinkSync(fork ? join(fixture, "npm/permission-fork-runtime/node_modules") : join(root, "node_modules"), join(packageRoot(name), "node_modules"));
}
if (fork) {
  for (const name of ["pi-ai", "pi-coding-agent", "pi-tui"]) {
    const destination=join(fixture, "npm/permission-fork-runtime/node_modules/@earendil-works",name);
    mkdirSync(dirname(destination), {recursive:true});
    symlinkSync(join(root, "node_modules/@earendil-works", name), destination);
  }
  for(const name of packages){const alias=join(fixture,"npm/permission-fork-runtime/node_modules",name);mkdirSync(dirname(alias),{recursive:true});symlinkSync(packageRoot(name),alias);}
  symlinkSync(join(root,"node_modules/zod"),join(fixture,"npm/permission-fork-runtime/node_modules/zod"));
  require("../bin/pi-web-fork-packages.cjs").verify(fixture, root, {skipSettings:true});
}
else assert.ok(applyPermissionCompatibility(fixture) > 0);

const jiti = createJiti(import.meta.url, { tsconfigPaths: true, moduleCache: false, alias: {
  "@gotgenes/pi-permission-system/audit": join(root, "node_modules/@gotgenes/pi-permission-system/src/service/permission-audit.ts"),
  "@earendil-works/pi-tui": fileURLToPath(import.meta.resolve("@earendil-works/pi-tui")),
  "@earendil-works/pi-ai/compat": fileURLToPath(import.meta.resolve("@earendil-works/pi-ai/compat")),
  "@gotgenes/pi-permission-system": join(packageRoot(packages[1]), "src/service.ts"),
} });
const { PermissionRpcAutoConfirmer } = await jiti.import(join(packageRoot(packages[0]), "src/rpc-auto-confirm.ts"));
const { requestPermissionDecision } = await jiti.import(join(packageRoot(packages[1]), "src/authority/permission-prompt-component.ts"));
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const CAPABILITY = Symbol.for("pi-permissions:rpc-reviewed-approval/v1");
const payload = () => ({ kind: "path", request: {
  requester: { agentName: null, sessionId: null, forwarded: false },
  surface: "path_write", toolName: "write", value: "/tmp/fixture.txt", matchedPattern: "*",
  invokedToolName: null, matchedSpelling: null, commandContext: null, executedUnit: null, decidingPath: null,
}, evidence: [{ label: "Input", text: "synthetic content", secondary: null }], annotations: [] });
function context(ui = {}) {
  return { ui, mode: "rpc", hasUI: true, sessionManager: { getSessionId: () => "fixture" }, signal: undefined };
}

test("patch installer is idempotent and rejects unknown source before any write", {skip:fork}, () => {
  assert.deepEqual(inspectPermissionCompatibility(fixture), []);
  assert.equal(applyPermissionCompatibility(fixture), 0);
  const file = join(packageRoot(packages[0]), "src/index.ts");
  const original = readFileSync(file, "utf8");
  writeFileSync(file, `${original}\n// unknown source\n`);
  assert.throws(() => applyPermissionCompatibility(fixture), /Unrecognized security source/);
  assert.equal(readFileSync(file, "utf8"), `${original}\n// unknown source\n`);
  writeFileSync(file, original);
});

test("RPC receipt binds request, full payload and one consumption", () => {
  const ctx = context();
  const bridge = new PermissionRpcAutoConfirmer(() => ["path"]);
  bridge.attach(ctx);
  assert.equal(bridge.stage("request", "path_write", payload()), true);
  assert.equal(ctx.ui[CAPABILITY].consume("another-request", payload()), false);
  assert.equal(ctx.ui[CAPABILITY].consume("request", payload()), true);
  assert.equal(ctx.ui[CAPABILITY].consume("request", payload()), false);
  for (const mutate of [p => { p.request.value = "/tmp/other.txt"; }, p => { p.evidence[0].text = "different command"; }, p => { p.request.surface = "path_read"; }]) {
    const changed = payload(); mutate(changed);
    bridge.stage("request", "path_write", payload());
    assert.equal(ctx.ui[CAPABILITY].consume("request", changed), false);
    assert.equal(ctx.ui[CAPABILITY].consume("request", payload()), false);
  }
  bridge.clear();
  assert.equal(ctx.ui[CAPABILITY], undefined);
});

test("expiry, cancellation, ownership change and disabled surfaces never auto-allow", () => {
  let now = 0;
  let enabled = ["path"];
  const ctx = context();
  const bridge = new PermissionRpcAutoConfirmer(() => enabled, 10, () => now);
  bridge.attach(ctx);
  bridge.stage("expired", "path_write", payload()); now = 10;
  assert.equal(ctx.ui[CAPABILITY].consume("expired", payload()), false);
  bridge.stage("cancelled", "path_write", payload());
  ctx.signal = AbortSignal.abort();
  assert.equal(ctx.ui[CAPABILITY].consume("cancelled", payload()), false);
  ctx.signal = undefined;
  bridge.stage("owner", "path_write", payload());
  ctx.sessionManager.getSessionId = () => "other-session";
  assert.equal(ctx.ui[CAPABILITY].consume("owner", payload()), false);
  ctx.sessionManager.getSessionId = () => "fixture";
  bridge.stage("disabled", "path_write", payload()); enabled = [];
  assert.equal(ctx.ui[CAPABILITY].consume("disabled", payload()), false);
  assert.equal(bridge.stage("disabled", "path_write", payload()), false);
  bridge.clear();
});

test("TUI, headless UI and another bridge owner are untouched", () => {
  const bridge = new PermissionRpcAutoConfirmer(() => ["path"]);
  for (const ctx of [{ ...context(), mode: "tui" }, { ...context(), hasUI: false }]) {
    bridge.attach(ctx);
    assert.equal(ctx.ui[CAPABILITY], undefined);
    assert.equal(bridge.stage("request", "path_write", payload()), false);
  }
  const owner = { version: 1, consume: () => false };
  const ctx = context({ [CAPABILITY]: owner });
  bridge.attach(ctx);
  bridge.clear();
  assert.equal(ctx.ui[CAPABILITY], owner);
});

test("real RPC terminal consumes review receipt without emitting a browser dialog and keeps machine provenance", async (t) => {
  const inner = { sessionId: "fixture", isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    sessionManager: { getCwd: () => "/tmp" }, agent: { state: {}, abort() {} },
    abortRetry() {}, abortCompaction() {}, abortBranchSummary() {}, dispose() {}, extensionRunner: {} };
  const wrapper = new AgentSessionWrapper(inner);
  t.after(() => wrapper.destroy());
  const ui = wrapper.createExtensionUiContext();
  const ctx = context(ui);
  const bridge = new PermissionRpcAutoConfirmer(() => ["path"]);
  t.after(() => bridge.clear());
  bridge.attach(ctx);
  const events = [];
  wrapper.onEvent(event => events.push(event));
  bridge.stage("request", "path_write", payload());
  const view = { mode: "rpc", ui, budget: { maxRows: 24, fieldMaxWidth: 400 } };
  const result = await requestPermissionDecision(view, "Permission Required", payload(), undefined, "request");
  assert.equal(result.approved, true);
  assert.deepEqual(result.decidedBy, { kind: "authorizer", name: "pi-auto-review", verdict: "allow", reason: null });
  assert.equal(events.some(event => event.method === "select"), false);
  const manual = requestPermissionDecision(view, "Permission Required", payload(), undefined, "not-reviewed");
  const prompt = events.findLast(event => event.method === "select");
  assert.ok(prompt);
  // Pending requests survive reconnect and cancel is a refusal.
  const replay = []; wrapper.onEvent(event => replay.push(event))();
  assert.ok(replay.some(event => event.id === prompt.id));
  await wrapper.send({ type: "extension_ui_response", id: prompt.id, cancelled: true });
  assert.equal((await manual).approved, false);
});

export { fixture, packageRoot, jiti };

const { createPiAutoReviewExtension } = await jiti.import(join(packageRoot(packages[0]), "src/index.ts"));
const { DEFAULT_CONFIG } = await jiti.import(join(packageRoot(packages[0]), "src/review/config.ts"));
const { publishPermissionsService, unpublishPermissionsService } = await jiti.import(join(packageRoot(packages[1]), "src/service.ts"));
const { composeAuthorizerChain } = await jiti.import(join(packageRoot(packages[1]), "src/authority/authorizer-chain.ts"));
const { AuthorizerSelection } = await jiti.import(join(packageRoot(packages[1]), "src/authority/authorizer-selection.ts"));
const { fauxAssistantMessage, fauxText } = await import("@earendil-works/pi-ai");
const { createFauxCore } = await import("../node_modules/@earendil-works/pi-ai/dist/providers/faux.js");
const { ModelRuntime, ModelRegistry } = await import("@earendil-works/pi-coding-agent");

async function reviewerHarness(t, { early = true, factory = createPiAutoReviewExtension } = {}) {
  const handlers = new Map(), listeners = new Map(), commands = new Map(), links = new Map(), sent = [];
  const events = { on(name, fn) { listeners.set(name, fn); }, emit(name, value) { listeners.get(name)?.(value); } };
  const pi = { on: (name, fn) => handlers.set(name, fn), events,
    registerCommand: (name, command) => commands.set(name, command), registerEntryRenderer() {}, appendEntry() {},
    sendUserMessage: (...args) => sent.push(args), sendMessage() {} };
  const faux = createFauxCore({ models: [{ id: "reviewer" }] });
  const runtime = await ModelRuntime.create({ authPath: join(fixture, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("faux", { baseUrl: "http://fixture.invalid", api: faux.api, apiKey: "synthetic-fixture", models: faux.models, streamSimple: faux.streamSimple });
  const registry = new ModelRegistry(runtime);
  const inner = { sessionId: "fixture", isStreaming: false, isCompacting: false, isBashRunning: false, isIdle: true,
    sessionManager: { getCwd: () => fixture }, agent: { state: {}, abort() {} },
    abortRetry() {}, abortCompaction() {}, abortBranchSummary() {}, dispose() {}, extensionRunner: {} };
  const wrapper = new AgentSessionWrapper(inner);
  const uiEvents = []; wrapper.onEvent(e => uiEvents.push(e));
  const ctx = { ...context(wrapper.createExtensionUiContext()), cwd: fixture, modelRegistry: registry, model: faux.getModel("reviewer"), isIdle: () => true,
    sessionManager: { getSessionId: () => "fixture", buildContextEntries: () => [{ type: "message", id: "user", message: { role: "user", content: "Write a synthetic file in this temporary test directory.", timestamp: Date.now() } }] } };
  const service = { registerAuthorizer(name, fn) { links.set(name, fn); return () => { if (links.get(name) === fn) links.delete(name); }; } };
  factory({ config: { ...DEFAULT_CONFIG, model: "current", retries: 0, failureMode: "defer", policyAudit: { enabled: false, retentionDays: 180 } }, allowUntrustedWorkspace: true })(pi);
  const ready = () => { publishPermissionsService("fixture", service); events.emit("permissions:ready", { sessionId: "fixture" }); };
  if (early) ready();
  await handlers.get("session_start")({}, ctx);
  if (!early) ready();
  t.after(async () => { await handlers.get("session_shutdown")(); unpublishPermissionsService("fixture", service); wrapper.destroy(); });
  return { handlers, events, commands, links, sent, faux, ctx, wrapper, uiEvents, ready };
}
async function waitUntil(predicate) { for (let i = 0; i < 500; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); } throw new Error("condition timed out"); }
const decisionText = outcome => JSON.stringify({ outcome, risk_level: outcome === "defer" ? "medium" : "low", user_authorization: "high", rationale: "Synthetic permission fixture." });
const query = { checkPermission: () => "ask" }, log = { review() {} };
function askDetails(id = "model-path") { const p = payload(); p.request.value = join(fixture, `${id}.txt`); return { requestId: id, surface: "path_write", source: "tool_call", toolName: "write", value: p.request.value, toolInputPreview: "synthetic content", payload: p }; }
async function runChain(h, details) {
  const terminal = { authorize: d => requestPermissionDecision({ mode: "rpc", ui: h.ctx.ui, budget: { maxRows: 24, fieldMaxWidth: 400 } }, "Permission Required", d.payload, undefined, d.requestId) };
  return composeAuthorizerChain([{ name: "pi-auto-review", authorize: h.links.get("pi-auto-review") }], terminal, query, log).authorize(details);
}

test("regression: original reviewer misses early ready; patched reviewer registers before first turn in either order", async t => {
  const { createPiAutoReviewExtension: originalFactory } = await jiti.import(join(root, "node_modules", packages[0], "src/index.ts"));
  await t.test("upstream reproducer", async t => { const h = await reviewerHarness(t, { factory: originalFactory }); assert.equal(h.links.size, 0); h.ready(); assert.equal(h.links.size, 1); });
  for (const early of [true, false]) await t.test(`patched ready first=${early}`, async t => {
    const h = await reviewerHarness(t, { early }); assert.equal(h.links.size, 1);
    const registered = h.links.get("pi-auto-review"); h.ready(); assert.equal(h.links.get("pi-auto-review"), registered);
    h.events.emit("permissions:ready", { sessionId: "another-session" }); assert.equal(h.links.get("pi-auto-review"), registered);
    await h.handlers.get("session_start")({}, h.ctx); assert.equal(h.links.size, 1); assert.notEqual(h.links.get("pi-auto-review"), registered);
  });
});

test("real reviewer finishes before RPC UI: allow skips dialog, defer waits for human, deny never prompts", async t => {
  for (const outcome of ["allow", "defer", "deny"]) await t.test(outcome, async t => {
    const h = await reviewerHarness(t); let release; let entered = false;
    h.faux.setResponses([async () => { entered = true; await new Promise(r => { release = r; }); return fauxAssistantMessage([fauxText(decisionText(outcome))]); }]);
    const resultPromise = runChain(h, askDetails());
    await waitUntil(() => entered); assert.equal(h.uiEvents.some(e => e.method === "select"), false, "human UI must not precede model");
    release();
    if (outcome === "defer") { await waitUntil(() => h.uiEvents.some(e => e.method === "select")); const prompt = h.uiEvents.findLast(e => e.method === "select"); await h.wrapper.send({ type: "extension_ui_response", id: prompt.id, value: "Yes" }); }
    const result = await resultPromise;
    assert.equal(result.approved, outcome !== "deny");
    assert.equal(h.uiEvents.filter(e => e.method === "select").length, outcome === "defer" ? 1 : 0);
    if (outcome === "allow") assert.equal(result.decidedBy.kind, "authorizer");
  });
});

test("RPC reviewer failure defers to human; shutdown during review denies stale result", async t => {
  await t.test("unavailable model", async t => {
    const h = await reviewerHarness(t); h.faux.setResponses([() => { throw new Error("synthetic offline"); }]);
    const result = runChain(h, askDetails("offline")); await waitUntil(() => h.uiEvents.some(e => e.method === "select"));
    const prompt = h.uiEvents.findLast(e => e.method === "select"); await h.wrapper.send({ type: "extension_ui_response", id: prompt.id, cancelled: true }); assert.equal((await result).approved, false);
  });
  await t.test("shutdown", async t => {
    const h = await reviewerHarness(t); let release; h.faux.setResponses([async () => { await new Promise(r => { release = r; }); return fauxAssistantMessage([fauxText(decisionText("allow"))]); }]);
    const result = runChain(h, askDetails("shutdown")); await waitUntil(() => release); await h.handlers.get("session_shutdown")(); release();
    assert.equal((await result).approved, false); assert.equal(h.uiEvents.some(e => e.method === "select"), false);
  });
});

test("missing configured automatic reviewer denies before terminal; unrelated missing links preserve fallback", async () => {
  for (const name of ["pi-auto-review", "optional-other"]) {
    let terminalCalls = 0;
    const selection = new AuthorizerSelection({ authorizerRegistry: { get() {} }, getAuthorizerChain: () => [name], chainAudit: { auditUnregisteredLink() {} }, logger: log,
      getPermissionQuery: () => query, prompter: { prompt: (chain, details) => chain.authorize(details) } });
    selection.authority = { adjudicatesLocally: true, terminal: { authorize: async () => { terminalCalls++; return { approved: true, state: "approved" }; } } };
    const result = await selection.escalate(askDetails("missing"));
    assert.equal(result.approved, name !== "pi-auto-review"); assert.equal(terminalCalls, name === "pi-auto-review" ? 0 : 1);
  }
});

test.after(() => rmSync(fixture, { recursive: true, force: true }));

test("RPC exact-retry recovery keeps human choice and critical typed challenge", async t => {
  for (const critical of [false, true]) await t.test(critical ? "critical" : "noncritical", async t => {
    const h = await reviewerHarness(t);
    const denied = { outcome: "deny", risk_level: critical ? "critical" : "low", user_authorization: "high", rationale: "Synthetic denied action." };
    h.faux.setResponses([fauxAssistantMessage([fauxText(JSON.stringify(denied))])]);
    assert.equal((await runChain(h, askDetails("recovery"))).approved, false);
    const command = h.commands.get(critical ? "auto-review-break-glass" : "auto-review-approve");
    const attempt = command.handler("", h.ctx);
    await waitUntil(() => h.uiEvents.some(e => e.method === "select"));
    let prompt = h.uiEvents.findLast(e => e.method === "select");
    await h.wrapper.send({ type: "extension_ui_response", id: prompt.id, value: prompt.options[0] });
    if (critical) {
      await waitUntil(() => h.uiEvents.some(e => e.method === "confirm"));
      prompt = h.uiEvents.findLast(e => e.method === "confirm");
      await h.wrapper.send({ type: "extension_ui_response", id: prompt.id, confirmed: true });
      await waitUntil(() => h.uiEvents.some(e => e.method === "input"));
      prompt = h.uiEvents.findLast(e => e.method === "input");
      const phrase = prompt.title.match(/BREAK-GLASS [A-F0-9]+/)[0];
      await h.wrapper.send({ type: "extension_ui_response", id: prompt.id, value: phrase });
    }
    await attempt; assert.equal(h.sent.length, 1); assert.deepEqual(h.sent[0][1], { deliverAs: "followUp" });
  });
  await t.test("cancelled selection does not grant a retry", async t => {
    const h = await reviewerHarness(t); h.faux.setResponses([fauxAssistantMessage([fauxText(decisionText("deny"))])]);
    await runChain(h, askDetails("cancel-recovery"));
    const attempt = h.commands.get("auto-review-approve").handler("", h.ctx);
    await waitUntil(() => h.uiEvents.some(e => e.method === "select")); const prompt = h.uiEvents.findLast(e => e.method === "select");
    await h.wrapper.send({ type: "extension_ui_response", id: prompt.id, cancelled: true }); await attempt; assert.equal(h.sent.length, 0);
  });
});

test("real Pi 1.3 session and both extensions execute a temporary write after review without a browser approval", async t => {
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const { fauxToolCall } = await import("@earendil-works/pi-ai");
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = fixture;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const configDir = join(fixture, "extensions", "pi-permission-system"); mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify({ permissionReviewLog: false, authorizerChain: ["pi-auto-review"], permission: { "*": "ask", write: "ask", path_write: { "*": "ask" } } }));
  const permission = await jiti.import(join(packageRoot(packages[1]), "src/index.ts"));
  const faux = createFauxCore({ models: [{ id: "integrated" }] });
  const runtime = await ModelRuntime.create({ authPath: join(fixture, "auth.json"), modelsPath: null, refreshOnCreate: false });
  runtime.registerProvider("faux", { baseUrl: "http://fixture.invalid", api: faux.api, apiKey: "synthetic-fixture", models: faux.models, streamSimple: faux.streamSimple });
  const settingsManager = SettingsManager.inMemory({ defaultTools: ["write"] });
  const reviewer = createPiAutoReviewExtension({ config: { ...DEFAULT_CONFIG, model: "current", retries: 0, failureMode: "deny", policyAudit: { enabled: false, retentionDays: 180 } }, allowUntrustedWorkspace: true });
  const resourceLoader = new DefaultResourceLoader({ cwd: fixture, agentDir: fixture, settingsManager, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    extensionFactories: [{ name: "permission-fixture", factory: permission.default }, { name: "reviewer-fixture", factory: reviewer }] });
  await resourceLoader.reload(); assert.equal(resourceLoader.getExtensions().errors.length, 0);
  const { session } = await createAgentSession({ cwd: fixture, agentDir: fixture, modelRuntime: runtime, model: faux.getModel("integrated"), settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(fixture) });
  const wrapper = new AgentSessionWrapper(session); t.after(() => wrapper.destroy()); const emitted = []; wrapper.onEvent(e => emitted.push(e));
  wrapper.beginExtensionBinding(); await wrapper.waitUntilReady();
  const marker = join(fixture, "integration-marker.txt");
  const answer = context => fauxAssistantMessage([fauxText(context.messages.length === 2 ? decisionText("allow") : "done")]);
  faux.setResponses([fauxAssistantMessage([fauxToolCall("write", { path: marker, content: "reviewed synthetic write" })]), answer, answer, answer, answer]);
  await wrapper.send({ type: "prompt", message: `Write exactly reviewed synthetic write to ${marker}.` });
  await waitUntil(() => !wrapper.isRunning());
  assert.equal(readFileSync(marker, "utf8"), "reviewed synthetic write");
  assert.equal(emitted.some(e => e.method === "select"), false);
  assert.ok(faux.state.callCount >= 3, "agent, reviewer and completion all ran");
});

test("explicit agent cancellation invalidates an in-flight model allow but leaves later reviews usable", async t => {
  const h = await reviewerHarness(t); let release;
  h.faux.setResponses([async () => { await new Promise(r => { release = r; }); return fauxAssistantMessage([fauxText(decisionText("allow"))]); }]);
  const result = runChain(h, askDetails("abort")); await waitUntil(() => release);
  h.handlers.get("agent_settled")({ aborted: true }); release();
  assert.equal((await result).approved, false); assert.equal(h.uiEvents.some(e => e.method === "select"), false);
  h.faux.setResponses([fauxAssistantMessage([fauxText(decisionText("allow"))])]);
  assert.equal((await runChain(h, askDetails("later"))).approved, true);
});
