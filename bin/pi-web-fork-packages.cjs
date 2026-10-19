/* eslint-disable @typescript-eslint/no-require-imports -- Node CLI uses CommonJS. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto"), os = require("node:os");
const { spawnSync } = require("node:child_process");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const runtimePackages = ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"];
const runtimeDirectory = agentDir => path.join(agentDir, "npm/permission-fork-runtime");
function read(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function bundle(root = path.resolve(__dirname, "..")) {
  const manifest = read(path.join(root, "vendor/permission-bundle.json"));
  if (manifest.schemaVersion !== 1 || manifest.piSdk !== "1.3.0") throw Error("Unsupported permission bundle");
  return { root, manifest };
}
function identity(source, agentDir) {
  if (typeof source !== "string") return null;
  const match = /^npm:(@(?:gotgenes\/pi-permission-system|erichll\/pi-auto-review))(?:@[^/]+)?$/.exec(source);
  if (match) return match[1];
  if (source.startsWith("npm:")) return null;
  const local = source.startsWith("~/") ? path.join(os.homedir(), source.slice(2)) : path.resolve(agentDir, source);
  try { return read(path.join(local, "package.json")).name; } catch { return null; }
}
function configured(agentDir, settings = read(path.join(agentDir, "settings.json"))) {
  const counts = new Map();
  for (const item of settings.packages ?? []) {
    const source = typeof item === "string" ? item : item?.source;
    const name = identity(source, agentDir);
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const source of settings.extensions ?? []) {
    if (typeof source === "string" && /(?:pi-permission-system|pi-auto-review)(?:\/|$)/.test(source)) throw Error("Permission plugins must load once from the locked package list, not duplicate extension paths");
  }
  return counts;
}
function verify(agentDir, root, options = {}) {
  const { manifest } = bundle(root);
  for (const name of runtimePackages) {
    const installed = path.join(runtimeDirectory(agentDir), "node_modules", name, "package.json");
    if (!fs.existsSync(installed) || read(installed).version !== manifest.piSdk) throw Error(`Permission runtime mismatch: expected ${name}@${manifest.piSdk}`);
  }
  if (!options.skipSettings) {
    const settings = read(path.join(agentDir, "settings.json"));
    const counts = configured(agentDir, settings);
    for (const item of settings.packages ?? []) {
      const source = typeof item === "string" ? item : item?.source;
      const name = identity(source, agentDir);
      if (manifest.packages[name] && source !== `npm:${name}@${manifest.packages[name].version}`) throw Error(`Use the locked npm identity for ${name}; local source overrides are not verified`);
    }
    for (const name of Object.keys(manifest.packages)) if (counts.get(name) !== 1) throw Error(`Expected exactly one configured ${name}; found ${counts.get(name) ?? 0}`);
  }
  for (const [name, spec] of Object.entries(manifest.packages)) {
    const installed = path.join(agentDir, "npm/node_modules", name);
    const runtimeModules = path.join(runtimeDirectory(agentDir), "node_modules");
    if (fs.realpathSync(path.join(installed, "node_modules")) !== fs.realpathSync(runtimeModules)
      || fs.realpathSync(path.join(runtimeModules, name)) !== fs.realpathSync(installed)) throw Error(`Permission runtime linkage mismatch: ${name}`);
    for (const [file, expected] of Object.entries(spec.files)) {
      const target = path.join(installed, file);
      if (!fs.existsSync(target) || hash(fs.readFileSync(target)) !== expected) throw Error(`Permission fork integrity mismatch: ${name}/${file}. Restore the locked bundle.`);
    }
    for (const directory of ["src", "dist"]) {
      const base = path.join(installed, directory); if (!fs.existsSync(base)) continue;
      for (const file of fs.readdirSync(base, { recursive: true, withFileTypes: true })) {
        if (!file.isFile()) continue;
        const relative = path.relative(installed, path.join(file.parentPath, file.name));
        if (!(relative in spec.files)) throw Error(`Unrecognized permission source: ${name}/${relative}`);
      }
    }
  }
  return manifest;
}
function install(agentDir, root, options = {}) {
  const { manifest } = bundle(root);
  // Verify all archives before npm or any package file is changed.
  const archives = Object.values(manifest.packages).map(spec => {
    const file = path.join(root, spec.archive);
    if (hash(fs.readFileSync(file)) !== spec.sha256) throw Error(`Permission archive integrity mismatch: ${spec.archive}`);
    return file;
  });
  const npmDir = path.join(agentDir, "npm"); fs.mkdirSync(npmDir, { recursive:true });
  // Other extensions may legitimately require older SDK peers. Install this
  // tested combination in its own runtime, keeping their package tree intact.
  const incoming = fs.mkdtempSync(path.join(npmDir, ".permission-incoming-"));
  const stagedRuntime = path.join(incoming, "runtime"), finalRuntime = runtimeDirectory(agentDir);
  const args = ['install','--prefix',stagedRuntime,'--ignore-scripts','--no-audit','--no-fund','--save-exact',...archives,...runtimePackages.map(name => `${name}@${manifest.piSdk}`)];
  if (options.cache) args.push('--cache',options.cache);
  const transaction = require('./pi-web-release-state.cjs');
  let state;
  try {
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {stdio:'inherit'});
    if (result.error || result.status !== 0) throw Error("Permission bundle install failed before activation");
    const changes = [{ target: finalRuntime, replacement: stagedRuntime }];
    for (const [index, name] of Object.keys(manifest.packages).entries()) {
      const installed = path.join(npmDir, 'node_modules', name), staged = path.join(incoming, `package-${index}`);
      const runtimePackage = path.join(stagedRuntime, 'node_modules', name);
      if (fs.existsSync(path.join(runtimePackage, 'node_modules'))) throw Error(`Unexpected nested runtime dependencies: ${name}`);
      fs.renameSync(runtimePackage, staged);
      fs.symlinkSync(path.relative(path.dirname(path.join(finalRuntime, 'node_modules', name)), installed), runtimePackage, 'dir');
      fs.symlinkSync(path.relative(installed, path.join(finalRuntime, 'node_modules')), path.join(staged, 'node_modules'), 'dir');
      fs.mkdirSync(path.dirname(installed), {recursive:true});
      changes.push({target:installed,replacement:staged});
    }
    state = transaction.prepare(path.join(incoming, 'backup'), changes);
    transaction.apply(state);
    const checked = verify(agentDir, root, options);
    fs.rmSync(incoming, {recursive:true,force:true});
    return checked;
  } catch (error) {
    if (state && state.phase !== 'rolled_back') transaction.rollback(state);
    // Keep the journal/staging for diagnosis if restoring the activation fails.
    throw error;
  }
}
module.exports = { bundle, configured, identity, install, verify };
