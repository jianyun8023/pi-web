import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { PERMISSION_AUDIT_CHANNEL } from "@gotgenes/pi-permission-system/audit";
import { auditKey, auditUpdate, type AuditRow } from "./permission-audit";

/** Public extension bus only. The bridge transports display data, never approvals. */
export function createPermissionAuditBridge() {
  let sink: ((row: AuditRow) => void) | undefined;
  let reset: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;
  const current = new Map<string, AuditRow>();
  const extension: InlineExtension = { name: "pi-web-permission-audit", hidden: true, factory: (pi) => {
    unsubscribe?.();
    current.clear();
    reset?.();
    unsubscribe = pi.events.on(PERMISSION_AUDIT_CHANNEL, value => {
      const row = auditUpdate(value);
      if (!row) return;
      current.set(auditKey(row.entry), row);
      sink?.(row);
    });
    pi.on("session_shutdown", () => { unsubscribe?.(); unsubscribe = undefined; current.clear(); });
  } };
  return { extension, connect(listener: (row: AuditRow) => void, onReset?: () => void) { sink = listener; reset = onReset; for (const row of current.values()) listener(row); }, snapshot: () => [...current.values()] };
}
