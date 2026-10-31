import { test } from "node:test";
import assert from "node:assert/strict";
import { ago, boardColumns, filterIssues, limitCards, projectsOf } from "../mods/linear-board/board.js";
import { NO_PROJECT, SYNC_TOOLS, parseRepos, parseSync } from "../mods/linear-board/sync.js";
import { safeUrl } from "../mods/linear-board/urls.js";

const stream = (results) => results.flatMap(([state, content], i) => [
  JSON.stringify({ message: { content: [{ type: "tool_use", id: `c${i}`, name: SYNC_TOOLS[0], input: { state } }] } }),
  JSON.stringify({ message: { content: [{ type: "tool_result", tool_use_id: `c${i}`, content: [{ type: "text", text: content }] }] } }),
]).join("\n");
const answer = (issues = []) => JSON.stringify({ issues });
const raw = { id: "ENG-1", title: "t", url: "u", priority: { value: 1, name: "Urgent" }, createdAt: "2026-10-30T09:00:00Z", status: "Backlog", statusType: "backlog", labels: ["API"], project: "P", parentId: null };

test("parseSync reads issues from the tool results", () => {
  const [issue] = parseSync(stream([["triage", answer()], ["backlog", answer([raw])], ["unstarted", answer()], ["started", answer()]]));
  assert.equal(issue.identifier, "ENG-1");
  assert.equal(issue.team, "ENG");
  assert.equal(issue.priority, 1);
  assert.equal(issue.labels[0].name, "API");
});

test("a state without an answer fails the sync", () => {
  assert.throws(() => parseSync(stream([["backlog", answer([raw])]])), /triage, unstarted, started/);
});

test("parseRepos expands ~ and tolerates a missing or broken file", () => {
  assert.deepEqual(parseRepos('{ "repos": { "eng": "~/dev/app" } }', "/h"), { ENG: "/h/dev/app" });
  assert.deepEqual(parseRepos(null, "/h"), {});
  assert.deepEqual(parseRepos("not json", "/h"), {});
});

test("filterIssues by id or title", () => {
  const issues = [{ identifier: "ENG-1", title: "Fix login" }, { identifier: "ENG-2", title: "Idea" }];
  const ids = (list) => list.map((i) => i.identifier);
  assert.deepEqual(ids(filterIssues(issues, "LOGIN")), ["ENG-1"]);
  assert.deepEqual(ids(filterIssues(issues, "eng-2")), ["ENG-2"]);
  assert.deepEqual(ids(filterIssues(issues, " ")), ["ENG-1", "ENG-2"]);
});

test("projectsOf counts projects, biggest first and no project last", () => {
  const issues = ["No project", "No project", "No project", "A", "B", "B"].map((project) => ({ project }));
  assert.deepEqual(projectsOf(issues), [{ name: "B", count: 2 }, { name: "A", count: 1 }, { name: NO_PROJECT, count: 3 }]);
});

test("filterIssues narrows by project along with the text", () => {
  const issues = [{ identifier: "ENG-1", title: "a", project: "A" }, { identifier: "ENG-2", title: "b", project: "B" }];
  assert.deepEqual(filterIssues(issues, "", "B").map((i) => i.identifier), ["ENG-2"]);
  assert.deepEqual(filterIssues(issues, "eng-1", "B"), []);
  assert.equal(filterIssues(issues, "").length, 2);
});

test("boardColumns orders states and puts urgent issues first", () => {
  const issue = (identifier, state, stateType, priority = 0) => ({ identifier, state, stateType, priority });
  const columns = boardColumns([
    issue("ENG-1", "In Review", "started"), issue("ENG-2", "In Progress", "started"), issue("ENG-3", "Todo", "unstarted"),
    issue("ENG-4", "Backlog", "backlog"), issue("ENG-5", "Backlog", "backlog", 3), issue("ENG-6", "Backlog", "backlog", 1), issue("ENG-7", "Triage", "triage"),
  ]);
  assert.deepEqual(columns.map((c) => c.name), ["Triage", "Backlog", "Todo", "In Progress", "In Review"]);
  assert.equal(columns.at(-1).kind, "review");
  assert.deepEqual(columns[1].issues.map((i) => i.identifier), ["ENG-6", "ENG-5", "ENG-4"]);
});

test("limitCards shares the limit out so no column starves", () => {
  const column = (n) => ({ issues: Array.from({ length: n }, (_, i) => i) });
  const shown = (columns, limit) => limitCards(columns, limit).map((c) => c.shown.length);
  assert.deepEqual(shown([column(10), column(1), column(10)], 6), [3, 1, 2]);
  assert.deepEqual(shown([column(2), column(1)], 80), [2, 1]);
  assert.deepEqual(shown([], 80), []);
});

test("ago takes an ISO date or a timestamp", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  assert.equal(ago("2026-10-30T09:00:00Z", now), "3h");
  assert.equal(ago(now - 5 * 60000, now), "5m");
});

test("safeUrl lets only https through", () => {
  assert.equal(safeUrl("https://linear.app/x"), "https://linear.app/x");
  assert.equal(safeUrl("http://linear.app/x"), null);
  assert.equal(safeUrl("file:///etc/passwd"), null);
  assert.equal(safeUrl("--help"), null);
});
