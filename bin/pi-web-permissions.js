#!/usr/bin/env node
"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const transforms = require("../compat/transforms.cjs");
const manifest = require("../compat/manifest.json");
const digest = (text) => crypto.createHash("sha256").update(text).digest("hex");

function inspectPermissionCompatibility(agentDir) {
  const changes = [];
  for (const [name, spec] of Object.entries(manifest.packages)) {
    const root = path.join(agentDir, "npm", "node_modules", name);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (pkg.version !== spec.version) throw new Error(`Unsupported ${name} version ${pkg.version}; expected ${spec.version}.`);
    for (const [file, hashes] of Object.entries(spec.files)) {
      const target = path.join(root, file);
      const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
      const currentHash = current === null ? null : digest(current);
      if (currentHash === hashes.patched) continue;
      if (currentHash !== hashes.original) throw new Error(`Unrecognized security source: ${name}/${file}. No files changed.`);
      const patched = transforms[name][file](current);
      if (digest(patched) !== hashes.patched) throw new Error(`Compatibility patch hash mismatch: ${name}/${file}.`);
      changes.push({ name, file, target, current, patched });
    }
  }
  return changes;
}

function applyPermissionCompatibility(agentDir) {
  // Validate the complete plan before changing either package.
  const changes = inspectPermissionCompatibility(agentDir);
  const completed = [];
  try {
    for (const change of changes) {
      const backup = `${change.target}.pi-web-original`;
      if (change.current !== null && !fs.existsSync(backup)) fs.writeFileSync(backup, change.current, { flag: "wx", mode: 0o600 });
      const temp = `${change.target}.pi-web-${process.pid}.tmp`;
      const mode = fs.existsSync(change.target) ? fs.statSync(change.target).mode & 0o777 : 0o644;
      fs.writeFileSync(temp, change.patched, { mode });
      fs.renameSync(temp, change.target);
      completed.push(change);
    }
  } catch (error) {
    for (const change of completed.reverse()) {
      if (change.current === null) fs.unlinkSync(change.target);
      else fs.writeFileSync(change.target, change.current);
    }
    throw error;
  }
  return changes.length;
}

function checkConfiguredPermissionCompatibility(agentDir) {
  if (fs.existsSync(path.join(__dirname, "../vendor/permission-bundle.json"))) {
    const settingsFile = path.join(agentDir, "settings.json");
    if (!fs.existsSync(settingsFile)) return;
    const locked = require("./pi-web-fork-packages.cjs");
    if (locked.configured(agentDir).size) locked.verify(agentDir, path.resolve(__dirname, ".."));
    return;
  }
  const settingsFile = path.join(agentDir, "settings.json");
  if (!fs.existsSync(settingsFile)) return;
  const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
  const enabled = (settings.packages || []).some((item) => {
    const source = typeof item === "string" ? item : item?.source;
    return typeof source === "string" && (source === "npm:@erichll/pi-auto-review" || source.startsWith("npm:@erichll/pi-auto-review@"));
  });
  if (enabled && inspectPermissionCompatibility(agentDir).length > 0) {
    throw new Error("Permission compatibility is not installed. Run node bin/pi-web-permissions.js --apply before starting this fork.");
  }
}

module.exports = { inspectPermissionCompatibility, applyPermissionCompatibility, checkConfiguredPermissionCompatibility };

if (require.main === module) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--agent-dir");
  const agentDir = index < 0 ? process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent") : path.resolve(args[index + 1]);
  try {
    if (fs.existsSync(path.join(__dirname, "../vendor/permission-bundle.json"))) {
      const locked = require("./pi-web-fork-packages.cjs");
      const root = path.resolve(__dirname, "..");
      if (args.includes("--apply")) locked.install(agentDir, root);
      else locked.verify(agentDir, root);
      console.log("Pi permission fork bundle: verified.");
    } else if (args.includes("--apply")) console.log(`Pi permission compatibility: ${applyPermissionCompatibility(agentDir)} files updated.`);
    else {
      const missing = inspectPermissionCompatibility(agentDir).length;
      if (missing) throw new Error(`Pi permission compatibility: ${missing} files need --apply.`);
      console.log("Pi permission compatibility: verified.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
