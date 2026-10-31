// Pure helpers for the Linear board: its columns, filter and dates.
// No Herdr imports, so `node --test` can load this file.

import { NO_PROJECT } from "./sync.js";

// The MCP gives no state colors: Linear's defaults, by kind. "review" is a started state named so.
export const STATE_COLORS = { triage: "#fc7840", backlog: "#95a2b3", unstarted: "#e2e2e2", started: "#4cb782", review: "#4cb782" };
const KIND_ORDER = ["triage", "backlog", "unstarted", "started", "review"];

export const stateKind = (issue) => (/review/i.test(issue.state) ? "review" : issue.stateType);

// One column per workflow state that has issues, most urgent first; no priority (0) goes last.
export function boardColumns(issues) {
  const columns = new Map();
  for (const issue of issues) {
    if (!columns.has(issue.state)) columns.set(issue.state, { name: issue.state, kind: stateKind(issue), issues: [] });
    columns.get(issue.state).issues.push(issue);
  }
  const rank = (issue) => issue.priority || 5;
  return [...columns.values()]
    .map((column) => ({ ...column, issues: column.issues.toSorted((a, b) => rank(a) - rank(b)) }))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

// The projects your issues are in, biggest first; issues without one come last.
export function projectsOf(issues) {
  const counts = new Map();
  for (const { project } of issues) counts.set(project, (counts.get(project) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => (a.name === NO_PROJECT) - (b.name === NO_PROJECT) || b.count - a.count);
}

// Each column's `shown` issues: at most `limit` in all, shared out one at a time so no column starves.
export function limitCards(columns, limit) {
  const counts = columns.map(() => 0);
  let left = Math.min(limit, columns.reduce((sum, c) => sum + c.issues.length, 0));
  while (left > 0) {
    columns.forEach((c, i) => {
      if (left > 0 && counts[i] < c.issues.length) { counts[i]++; left--; }
    });
  }
  return columns.map((c, i) => ({ ...c, shown: c.issues.slice(0, counts[i]) }));
}

export function filterIssues(issues, text, project = null) {
  const needle = (text ?? "").trim().toLowerCase();
  return issues.filter((i) => (!project || i.project === project)
    && (!needle || `${i.identifier} ${i.title}`.toLowerCase().includes(needle)));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso) {
  const date = new Date(iso);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function ago(time, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(time).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}
