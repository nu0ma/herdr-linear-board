// Your open Linear issues as a board of state columns. A click opens the issue; `Agent` starts an
// agent on it in a new worktree.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, home, appHome, props, readTextFile, writeTextFile, nextCommand, shared, setShared } from "herdr";
import { SYNC_PROMPT, SYNC_TOOLS, parseRepos, parseSync } from "./sync.js";
import { ago, boardColumns, filterIssues, limitCards, projectsOf } from "./board.js";
import { Card, board, stateIcon } from "./card.js";

// Issues come from the Linear MCP through `claude -p`: a mod can't call MCP itself, and each sync
// costs a model run, so a recent snapshot is shown as it is.
const SYNC_MS = 30 * 60000;
const CACHE_KEY = "linear-board.snapshot";
const PROJECT_KEY = "linear-board.project";
// The app's environment can carry a Claude session's markers.
const CLEAN_START = 'unset CLAUDECODE $(env | sed -n "s/^\\(CLAUDE_CODE_[A-Z_]*\\)=.*/\\1/p"); exec "$@" </dev/null';
const CARD_GAP = 8;
// Even as child views, about 200 cards overrun the board's own render. The rest stay behind filters.
const CARD_LIMIT = 80;
// Fixed, so a filter that leaves few columns doesn't stretch the cards.
const COLUMN_WIDTH = 280;
const SPINNER = "mods/linear-board/spinner.svg";

const snapshotFile = () => `${appHome()}/linear-board-issues.json`;

async function syncIssues() {
  const r = await exec("sh", ["-c", CLEAN_START, "sh", "claude", "-p", SYNC_PROMPT, "--model", "haiku", "--output-format", "stream-json", "--verbose",
    "--tools", "", "--allowedTools", SYNC_TOOLS.join(","), "--no-session-persistence"], { cwd: home() });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").at(-1) || "claude -p failed");
  return parseSync(r.stdout);
}

export default class Linear extends View {
  init(_props, cx) {
    this.issues = []; this.cards = new Map(); this.text = ""; this.loading = false; this.project = shared(PROJECT_KEY) ?? null;
    board.overlay = props()?.overlay ?? null;
    // Every open is a new copy: the cache in shared state is there at once, the file isn't.
    const cached = shared(CACHE_KEY);
    if (cached) { this.setIssues(cached, cx); this.loaded = true; }
    this.search = InputState.new({ placeholder: "Filter by id or title" });
    this.search.on("change", (_e, cx) => { this.text = this.search.value(); this.ensureCards(cx); cx.notify(); });
    cx.spawn(async (cx) => {
      board.repos = parseRepos(await readTextFile(`${appHome()}/linear-board.json`).catch(() => null), home());
      try {
        // The file outlives shared state, so it can be newer than the cache.
        const snapshot = JSON.parse(await readTextFile(snapshotFile()));
        if (snapshot.at > (this.syncedAt ?? 0)) this.show(snapshot, cx);
      } catch { /* none yet */ }
      this.loaded = true;
      if (!this.syncedAt || Date.now() - this.syncedAt > SYNC_MS) this.refresh(cx);
      cx.notify();
    });
    cx.timer.every(SYNC_MS, (cx) => this.refresh(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        if (command === "refresh") this.refresh(cx);
        cx.notify();
      }
    });
  }

  setIssues(snapshot, cx) {
    const issues = new Map(snapshot.issues.map((issue) => [issue.identifier, issue]));
    for (const [id, card] of this.cards) {
      if (issues.has(id)) card.set_props({ issue: issues.get(id) });
      else { card.release(); this.cards.delete(id); }
    }
    this.issues = snapshot.issues; this.syncedAt = snapshot.at;
    this.ensureCards(cx);
  }

  // A sync can take the chosen project away.
  activeProject() {
    return this.issues.some((i) => i.project === this.project) ? this.project : null;
  }

  columns() {
    return limitCards(boardColumns(filterIssues(this.issues, this.text, this.activeProject())), CARD_LIMIT);
  }

  // Cards are made here, for the ones on show: a view can't be created during render.
  ensureCards(cx) {
    for (const issue of this.columns().flatMap((c) => c.shown)) {
      if (!this.cards.has(issue.identifier)) this.cards.set(issue.identifier, cx.new(Card, { issue }));
    }
  }

  show(snapshot, cx) {
    this.setIssues(snapshot, cx);
    setShared(CACHE_KEY, snapshot);
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const issues = await syncIssues(), at = Date.now();
        this.show({ at, issues }, cx); this.error = null;
        await writeTextFile(snapshotFile(), JSON.stringify({ at, issues }), await readTextFile(snapshotFile()));
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  column(column, t) {
    const { issues, shown } = column, id = `column-${column.name}`, hidden = issues.length - shown.length;
    return v_flex().size_full().min_h(0).gap(4)
      .child(h_flex().h(34).flex_none().px(4).gap(8).items_center()
        .child(stateIcon(column.kind))
        .child(div().text_size(13).font_medium().child(column.name))
        .child(div().text_size(12).text_color(t.dim).child(String(issues.length))))
      .child(v_flex().id(id).flex_1().min_h(0).gap(CARD_GAP).pb(CARD_GAP).overflow_y_scrollbar()
        .children(shown.map((issue) => this.cards.get(issue.identifier)))
        .when(hidden > 0, (e) => e.child(div().flex_none().px(4).py(6).text_size(11).text_color(t.dim).child(`${hidden} more: filter to see them`))));
  }

  // index null: the All chip, which clears the filter.
  projectChip(name, count, index, active, t) {
    return h_flex().id(`project-${index ?? "all"}`).h(26).px(9).gap(6).flex_none().max_w(320).items_center().rounded(7).cursor_pointer().text_size(11.5)
      .bg(active ? t.selected : t.raised).text_color(active ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.project = index === null ? null : name; setShared(PROJECT_KEY, this.project); this.ensureCards(cx); cx.notify(); })
      .child(div().min_w(0).truncate().child(name))
      .child(div().flex_none().text_color(t.dim).child(String(count)));
  }

  spinner(size, t) {
    return svg(SPINNER).size(size).flex_none().text_color(t.muted).spin(900);
  }

  emptyText() {
    if (this.error) return this.error;
    return this.issues.length ? "No issues match this filter" : "No open issues assigned to you";
  }

  render() {
    const t = theme(), projects = projectsOf(this.issues);
    const project = this.activeProject(), columns = this.columns();
    const waiting = !this.loaded || (this.loading && !this.issues.length);
    return v_flex().id("linear-board").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13)
      .child(h_flex().h(46).flex_none().px(14).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Linear"))
        .when(!waiting, (e) => e.child(div().text_size(11).text_color(t.dim).child(`${this.issues.length} open${this.syncedAt ? ` · synced ${ago(this.syncedAt)} ago` : ""}`)))
        .child(div().flex_1())
        .child(div().w(220).flex_none().h(26).px(8).flex().items_center().rounded(7).border_1()
          .border_color(this.text.trim() ? t.accent : t.border).bg(t.background)
          .child(Input.new(this.search).h_full().text_size(11).text_color(t.foreground)))
        .child(div().id("refresh").px(8).h(26).flex().items_center().rounded(7).cursor_pointer().text_size(11).text_color(t.muted)
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.refresh(cx)).child(this.loading ? this.spinner(13, t) : "Refresh")))
      .when(projects.length > 0, (e) => e.child(h_flex().flex_none().flex_wrap().px(14).py(8).gap(6).items_center().border_b(1).border_color(t.border)
        .child(this.projectChip("All", this.issues.length, null, project === null, t))
        .children(projects.map((p, i) => this.projectChip(p.name, p.count, i, project === p.name, t)))))
      .when(Boolean(this.error) && columns.length > 0, (e) => e.child(div().flex_none().px(14).py(6).text_size(11).text_color(t.ansi1).child(this.error)))
      .when(columns.length > 0, (e) => e.child(h_flex().id("board").flex_1().min_h(0).px(12).pt(6).gap(12).items_start().overflow_x_scrollbar()
        .children(columns.map((c) => div().h_full().w(COLUMN_WIDTH).flex_none().child(this.column(c, t))))))
      .when(waiting, (e) => e.child(h_flex().flex_1().min_h(0).gap(10).items_center().justify_center().text_color(t.dim)
        .child(this.spinner(18, t)).child("Loading issues…")))
      .when(!waiting && !columns.length, (e) => e.child(div().p(16).text_color(this.error ? t.ansi1 : t.dim).child(this.emptyText())));
  }
}
