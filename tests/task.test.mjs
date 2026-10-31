import { test } from "node:test";
import assert from "node:assert/strict";
import { branchFor, folderName, worktreeFolder, branchProblem, taskFor } from "../mods/linear-board-agent/task.js";

const issue = {
  identifier: "ENG-12", title: "Fix login with SSO", url: "https://linear.app/acme/issue/ENG-12/fix-login",
  branchName: "dan/eng-12-fix-login", description: "Users can't log in\n\nwith SSO.",
};

test("branchFor uses Linear's suggested branch", () => {
  assert.equal(branchFor(issue), "dan/eng-12-fix-login");
});

test("branchFor falls back to the identifier and title", () => {
  assert.equal(branchFor({ ...issue, branchName: "" }), "eng-12-fix-login-with-sso");
  assert.equal(branchFor({ ...issue, branchName: null, title: "Ácentos y ñandú: ¡ya!" }), "eng-12-acentos-y-nandu-ya");
});

test("folderName turns a branch into one path segment", () => {
  assert.equal(folderName("dan/eng-12-fix-login"), "dan-eng-12-fix-login");
  assert.equal(folderName("../../etc"), "..-..-etc".replace(/^-+|-+$/g, ""));
  assert.ok(!folderName("../../etc").includes("/"));
});

test("taskFor is one line with the issue and its rules", () => {
  const task = taskFor(issue, "dan/eng-12-fix-login", { subagents: false });
  assert.ok(!task.includes("\n"));
  assert.match(task, /Linear issue ENG-12: Fix login with SSO/);
  assert.match(task, /https:\/\/linear\.app\/acme\/issue\/ENG-12\/fix-login/);
  assert.match(task, /branch dan\/eng-12-fix-login/);
  assert.match(task, /Users can't log in with SSO\./);
  assert.match(task, /Do not merge or deploy/);
  assert.doesNotMatch(task, /subagent/i);
});

test("taskFor asks for subagents only when chosen", () => {
  assert.match(taskFor(issue, "b", { subagents: true }), /subagents/);
});

test("taskFor shortens long descriptions", () => {
  const task = taskFor({ ...issue, description: "x".repeat(5000) }, "b", { subagents: false });
  assert.ok(task.length < 1500);
  assert.match(task, /x…/);
});

test("taskFor works without a description", () => {
  assert.doesNotMatch(taskFor({ ...issue, description: null }, "b", { subagents: false }), /Summary/);
});

test("branchProblem refuses names git would read as options", () => {
  assert.match(branchProblem("-M"), /cannot start with "-"/);
  assert.match(branchProblem("--set-upstream-to=HEAD"), /cannot start with "-"/);
  assert.match(branchProblem("  "), /empty/);
  assert.equal(branchProblem("dan/eng-12-fix-login"), null);
});

test("worktreeFolder never lands on the repo's worktrees folder itself", () => {
  assert.equal(worktreeFolder("dan/eng-12", "ENG-12"), "dan-eng-12");
  assert.equal(worktreeFolder("!.!", "ENG-12"), "ENG-12");
  assert.equal(worktreeFolder("!!!", "ENG-12"), "ENG-12");
  assert.equal(worktreeFolder("..", "ENG-12"), "ENG-12");
});

test("taskFor strips control characters from Linear's text", () => {
  const task = taskFor({ ...issue, title: "t\r\u0003x", description: "d\u0003\u001b[2Jx" }, "b", { subagents: false });
  assert.doesNotMatch(task, /[\u0000-\u001f\u007f-\u009f]/);
  assert.match(task, /t x/);
});

test("taskFor starts with the skill and adds the instructions", () => {
  const task = taskFor(issue, "b", { subagents: false, skill: " /review ", instructions: "Only touch\nthe API.\u0003" });
  assert.ok(task.startsWith("/review Work on Linear issue ENG-12"));
  assert.match(task, /Instructions: Only touch the API\./);
  assert.doesNotMatch(task, /[\u0000-\u001f\u007f-\u009f]/);
});

test("taskFor leaves skill and instructions out when blank", () => {
  const task = taskFor(issue, "b", { subagents: false, skill: "  ", instructions: "\n" });
  assert.ok(task.startsWith("Work on Linear issue"));
  assert.doesNotMatch(task, /Instructions/);
});
