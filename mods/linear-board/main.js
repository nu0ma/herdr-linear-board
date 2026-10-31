// Your open Linear issues as a board of state columns. A click opens the issue; `Agent` starts an
// agent on it in a new worktree.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, theme, home, appHome, readTextFile, writeTextFile, nextCommand, openOverlay, shared, setShared } from "herdr";
import { SYNC_PROMPT, SYNC_TOOLS, parseRepos, parseSync } from "./sync.js";
import { STATE_COLORS, ago, boardColumns, filterIssues, projectsOf, shortDate, stateKind } from "./board.js";
import { openUrl } from "./open.js";

// Issues come from the Linear MCP through `claude -p`: a mod can't call MCP itself, and each sync
// costs a model run, so a recent snapshot is shown as it is.
const SYNC_MS = 30 * 60000;
const CACHE_KEY = "linear-board.snapshot";
const PROJECT_KEY = "linear-board.project";
// The app's environment can carry a Claude session's markers.
const CLEAN_START = 'unset CLAUDECODE $(env | sed -n "s/^\\(CLAUDE_CODE_[A-Z_]*\\)=.*/\\1/p"); exec "$@" </dev/null';
const CARD_GAP = 8;
// Fixed, so a filter that leaves few columns doesn't stretch the cards.
const COLUMN_WIDTH = 280;
// Two lines of title, so cards line up across columns.
const TITLE_HEIGHT = 42;
const LABEL_LIMIT = 3;
const URGENT = "#f2681f";
const PRIORITY_ICONS = { 2: "high", 3: "medium", 4: "low" };
const SPINNER = "mods/linear-board/spinner.svg";

const snapshotFile = () => `${appHome()}/linear-board-issues.json`;

async function syncIssues() {
  const r = await exec("sh", ["-c", CLEAN_START, "sh", "claude", "-p", SYNC_PROMPT, "--model", "haiku", "--output-format", "stream-json", "--verbose",
    "--tools", "", "--allowedTools", SYNC_TOOLS.join(","), "--no-session-persistence"], { cwd: home() });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split("\n").at(-1) || "claude -p failed");
  return parseSync(r.stdout);
}

// The focused pane's folder (else the focused terminal's, else the shown space's) and its machine.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

export default class Linear extends View {
  init(_props, cx) {
    this.issues = []; this.text = ""; this.loading = false; this.project = shared(PROJECT_KEY) ?? null;
    // Every open is a new copy: the cache in shared state is there at once, the file isn't.
    const cached = shared(CACHE_KEY);
    if (cached) { this.issues = cached.issues; this.syncedAt = cached.at; this.loaded = true; }
    this.search = InputState.new({ placeholder: "Filter by id or title" });
    this.search.on("change", (_e, cx) => { this.text = this.search.value(); cx.notify(); });
    cx.spawn(async (cx) => {
      this.repos = parseRepos(await readTextFile(`${appHome()}/linear-board.json`).catch(() => null), home());
      try {
        // The file outlives shared state, so it can be newer than the cache.
        const snapshot = JSON.parse(await readTextFile(snapshotFile()));
        if (snapshot.at > (this.syncedAt ?? 0)) this.show(snapshot);
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

  show(snapshot) {
    this.issues = snapshot.issues; this.syncedAt = snapshot.at;
    setShared(CACHE_KEY, snapshot);
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const issues = await syncIssues(), at = Date.now();
        this.show({ at, issues }); this.error = null;
        await writeTextFile(snapshotFile(), JSON.stringify({ at, issues }), await readTextFile(snapshotFile()));
      } catch (e) { this.error = String(e.message ?? e); }
      finally { this.loading = false; cx.notify(); }
    });
    cx.notify();
  }

  // A team mapped in linear-board.json works on that folder here; otherwise the space you're in.
  startAgent(issue) {
    const { cwd, on } = location(), mapped = this.repos?.[issue.team];
    openOverlay({ mod: "linear-board-agent", kind: "dialog", width: 480, height: 660,
      props: { issue, cwd: mapped ?? cwd, on: mapped ? null : on } });
  }

  stateIcon(kind) {
    return svg(`mods/linear-board/state-${kind}.svg`).size(14).flex_none().text_color(STATE_COLORS[kind]);
  }

  pill(t) {
    return h_flex().h(22).flex_none().items_center().rounded_full().border_1().border_color(t.border);
  }

  priorityPill(issue, t) {
    const pill = this.pill(t).w(28).justify_center();
    if (issue.priority === 1) {
      return pill.child(div().size(14).flex().items_center().justify_center().rounded(3).bg(URGENT)
        .text_size(10).font_bold().text_color("#ffffff").child("!"));
    }
    return pill.child(svg(`mods/linear-board/priority-${PRIORITY_ICONS[issue.priority] ?? "none"}.svg`).size(14).text_color(t.muted));
  }

  labelPill(label, t) {
    return this.pill(t).px(8).gap(5).text_size(11).text_color(t.muted)
      .child(div().size(8).rounded_full().bg(label.color))
      .child(label.name);
  }

  card(issue, t) {
    const parent = issue.parent ? issue.parent.title ?? issue.parent.identifier : null;
    return v_flex().id(`card-${issue.identifier}`).relative().flex_none().w_full().px(12).py(10).gap(6).rounded(8).overflow_hidden().cursor_pointer()
        .bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.hover)).on_click(() => openUrl(issue.url))
        .child(h_flex().flex_none().gap(5).items_center().text_size(11.5).text_color(t.dim)
          .child(div().flex_none().child(issue.identifier))
          .when(Boolean(parent), (e) => e.child(div().flex_none().child("›")).child(div().flex_1().min_w(0).truncate().child(parent))))
        .child(h_flex().flex_none().h(TITLE_HEIGHT).gap(7).items_start().overflow_hidden()
          .child(div().flex_none().pt(2).child(this.stateIcon(stateKind(issue))))
          .child(div().flex_1().min_w(0).text_size(13).child(issue.title)))
        .child(h_flex().flex_none().gap(5).items_center().overflow_hidden()
          .child(this.priorityPill(issue, t))
          .children(issue.labels.slice(0, LABEL_LIMIT).map((l) => this.labelPill(l, t))))
        .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`Created ${shortDate(issue.createdAt)}`))
        .child(this.agentButton(issue, t));
  }

  agentButton(issue, t) {
    return div().id(`agent-${issue.identifier}`).absolute().right(8).bottom(8).px(8).h(22).flex().items_center().rounded(6)
      .text_size(11).text_color(t.muted).bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.background).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); this.startAgent(issue); }).child("Agent");
  }

  column(column, t) {
    const { issues } = column, id = `column-${column.name}`;
    return v_flex().size_full().min_h(0).gap(4)
      .child(h_flex().h(34).flex_none().px(4).gap(8).items_center()
        .child(this.stateIcon(column.kind))
        .child(div().text_size(13).font_medium().child(column.name))
        .child(div().text_size(12).text_color(t.dim).child(String(issues.length))))
      .child(v_flex().id(id).flex_1().min_h(0).gap(CARD_GAP).pb(CARD_GAP).overflow_y_scrollbar()
        .children(issues.map((issue) => this.card(issue, t))));
  }

  // index null: the All chip, which clears the filter.
  projectChip(name, count, index, active, t) {
    return h_flex().id(`project-${index ?? "all"}`).h(26).px(9).gap(6).flex_none().max_w(320).items_center().rounded(7).cursor_pointer().text_size(11.5)
      .bg(active ? t.selected : t.raised).text_color(active ? t.foreground : t.muted).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.project = index === null ? null : name; setShared(PROJECT_KEY, this.project); cx.notify(); })
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
    // A sync can take the chosen project away.
    const project = projects.some((p) => p.name === this.project) ? this.project : null;
    const columns = boardColumns(filterIssues(this.issues, this.text, project));
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
