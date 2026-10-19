"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { auditKey, auditStatus, type AuditRow } from "@/lib/permission-audit";
import { useI18n } from "@/hooks/useI18n";

const AuditContext = createContext<{ rows: AuditRow[]; sessionId: string | null }>({ rows: [], sessionId: null });
export function PermissionAuditProvider({ rows, sessionId, children }: { rows: AuditRow[]; sessionId: string | null; children: ReactNode }) {
  const value = useMemo(() => ({ rows, sessionId }), [rows, sessionId]);
  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
}
function AuditRecord({ row }: { row: AuditRow }) {
  const { t } = useI18n();
  const { sessionId } = useContext(AuditContext);
  const { entry, storage } = row;
  return <li className="border-t border-[var(--border)] py-2" data-audit-status={auditStatus(row)}>
    <div className="flex flex-wrap gap-x-2 font-medium">
      <span>{t(`permissionAudit.${auditStatus(row)}`)}</span>
      <span>{entry.request.toolName ?? entry.request.surface}</span>
      {entry.kind === "tool" && <span>{t("permissionAudit.wholeTool")}</span>}
      {entry.sessionId !== sessionId && <span>{t(entry.adjudicatorSessionId === sessionId ? "permissionAudit.forwarded" : "permissionAudit.inherited")}</span>}
      {storage !== "saved" && <span role="status">{t(`permissionAudit.${storage}`)}</span>}
    </div>
    <div className="break-words text-[var(--muted)]">{entry.request.targetSummary}</div>
    {entry.review && <p className="break-words">{t("permissionAudit.model")}: {t(`permissionAudit.verdict.${entry.review.outcome}`)} · {entry.review.model} · {(entry.review.durationMs / 1000).toFixed(2)} s · {entry.review.reasonCode === "verdict" ? "" : t(`permissionAudit.${entry.review.reasonCode}`)} {entry.review.reasonSummary}</p>}
    {entry.final && <p>{t("permissionAudit.final")}: {t(`permissionAudit.source.${entry.final.source}`)} · {entry.final.resolution}{entry.final.reasonSummary ? ` — ${entry.final.reasonSummary}` : ""}</p>}
    <p className="break-words text-[var(--muted)]">{entry.request.surface}{entry.request.matchedRule ? ` · ${entry.request.matchedRule}` : ""}{entry.request.policyOrigin ? ` · ${entry.request.policyOrigin}` : ""} · {new Date(entry.occurredAt).toLocaleTimeString()}</p>
  </li>;
}
export function PermissionReviewDetails({ toolCallId }: { toolCallId: string }) {
  const { rows } = useContext(AuditContext);
  const { t } = useI18n();
  const matching = rows.filter(row => row.entry.toolCallId === toolCallId || row.entry.parentToolCallId === toolCallId);
  if (!matching.length) return null;
  const complete = matching.find(row => row.entry.kind === "tool" && row.entry.toolCallId === toolCallId);
  const waiting = matching.find(row => auditStatus(row) === "waiting");
  return <details className="px-3 py-1 text-xs" data-permission-audit="tool">
    <summary className="cursor-pointer py-1">{t("permissionAudit.title")} · {t(`permissionAudit.${complete ? auditStatus(complete) : waiting ? "waiting" : matching.some(row => row.live) ? "reviewing" : "unknown"}`)}</summary>
    <p className="text-[var(--muted)]">{t("permissionAudit.permissionOnly")}</p>
    <ul>{matching.map(row => <AuditRecord key={auditKey(row.entry)} row={row} />)}</ul>
  </details>;
}
export function PermissionAuditHistory() {
  const { rows } = useContext(AuditContext);
  const { t } = useI18n();
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(30);
  const gates = rows.filter(row => row.entry.kind === "gate");
  const visible = gates.filter(row => filter === "all" || auditStatus(row) === filter).toReversed();
  return <details className="mx-auto mb-3 w-full rounded border border-[var(--border)] px-3 py-1 text-xs" data-permission-audit="history">
    <summary className="cursor-pointer py-2">{t("permissionAudit.history")} · {gates.length}</summary>
    <p className="mb-2 text-[var(--muted)]">{t("permissionAudit.permissionOnly")}</p>
    {!rows.length ? <p>{t("permissionAudit.noRecords")}</p> : <>
      <label className="flex items-center gap-2">{t("permissionAudit.filter")}<select aria-label={t("permissionAudit.filter")} value={filter} onChange={event => { setFilter(event.target.value); setLimit(30); }} className="rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1">
        {["all", "allow", "deny", "waiting", "reviewing", "cancelled", "unknown"].map(value => <option key={value} value={value}>{t(`permissionAudit.${value}`)} ({value === "all" ? gates.length : gates.filter(row => auditStatus(row) === value).length})</option>)}
      </select></label>
      <ul className="mt-2 max-h-80 overflow-auto">{visible.slice(0, limit).map(row => <AuditRecord key={auditKey(row.entry)} row={row} />)}</ul>
      {visible.length > limit && <button className="my-2 underline" onClick={() => setLimit(value => value + 30)}>{t("permissionAudit.more")}</button>}
    </>}
  </details>;
}
