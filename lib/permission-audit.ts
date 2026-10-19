import { PERMISSION_AUDIT_TYPE, projectPermissionAuditEntry, type PermissionAuditEntry, type PermissionAuditUpdate } from "@gotgenes/pi-permission-system/audit";

export type AuditRow = PermissionAuditUpdate & { live: boolean };
export function auditKey(entry: PermissionAuditEntry): string {
  return JSON.stringify([entry.sessionId, entry.adjudicatorSessionId, entry.generationId, entry.requestId]);
}
export function auditUpdate(value: unknown, live = true): AuditRow | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PermissionAuditUpdate>;
  const entry = projectPermissionAuditEntry(candidate.entry);
  if (!entry || !["saved", "memory", "error"].includes(candidate.storage ?? "")) return null;
  return { entry, storage: candidate.storage!, live };
}
/** Latest phase per gate; final is terminal even after a duplicate/reordered SSE. */
export function mergeAuditRows(previous: readonly AuditRow[], incoming: readonly AuditRow[]): AuditRow[] {
  const rows = new Map(previous.map(row => [auditKey(row.entry), row]));
  for (const candidate of incoming) {
    const row = auditUpdate(candidate, candidate.live);
    if (!row) continue;
    const key = auditKey(row.entry), old = rows.get(key);
    if (old?.entry.final && !row.entry.final) continue;
    if (!old || row.entry.sequence > old.entry.sequence) rows.set(key, row);
    else if (row.entry.sequence === old.entry.sequence) rows.set(key, { ...old, live: old.live || row.live, storage: old.storage === "error" || row.storage === "error" ? "error" : row.storage });
  }
  return [...rows.values()].sort((a, b) => a.entry.occurredAt.localeCompare(b.entry.occurredAt) || auditKey(a.entry).localeCompare(auditKey(b.entry)));
}
export function projectAuditBranch(entries: readonly { type: string; customType?: string; data?: unknown }[]): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== PERMISSION_AUDIT_TYPE) continue;
    const data = projectPermissionAuditEntry(entry.data);
    if (data) rows.push({ entry: data, storage: "saved", live: false });
  }
  return mergeAuditRows([], rows);
}
export function auditStatus(row: AuditRow): "allow" | "deny" | "reviewing" | "waiting" | "unknown" | "cancelled" {
  if (row.entry.final?.resolution === "cancelled") return "cancelled";
  if (row.entry.final) return row.entry.final.result;
  if (!row.live) return "unknown";
  return row.entry.phase === "awaiting_human" ? "waiting" : "reviewing";
}
