// One card on the board. A view of its own because a render has a time budget that about 24 cards
// overrun: as child views each card spends its own budget.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, focused, theme, openOverlay } from "herdr";
import { STATE_COLORS, shortDate, stateKind } from "./board.js";
import { openUrl } from "./open.js";

const CARD_RADIUS = 8;
// Room for two lines, so short titles line up. Longer ones make their card taller.
const TITLE_HEIGHT = 42;
const LABEL_LIMIT = 3;
const URGENT = "#f2681f";
const PRIORITY_ICONS = { 2: "high", 3: "medium", 4: "low" };

// What cards need from the board: the team folders from its config, and the popup to close.
export const board = { repos: {}, overlay: null };

// The focused pane's folder (else the focused terminal's, else the shown space's) and its machine.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

// A team mapped in linear-board.json works on that folder here; otherwise the space you're in.
function startAgent(issue) {
  const { cwd, on } = location(), mapped = board.repos[issue.team];
  openOverlay({ mod: "linear-board-agent", kind: "dialog", width: 480, height: 660,
    props: { issue, cwd: mapped ?? cwd, on: mapped ? null : on, board: board.overlay } });
}

export const stateIcon = (kind) => svg(`mods/linear-board/state-${kind}.svg`).size(14).flex_none().text_color(STATE_COLORS[kind]);

const pill = (t) => h_flex().h(22).flex_none().items_center().rounded_full().border_1().border_color(t.border);

function priorityPill(issue, t) {
  const frame = pill(t).w(28).justify_center();
  if (issue.priority === 1) {
    return frame.child(div().size(14).flex().items_center().justify_center().rounded(3).bg(URGENT)
      .text_size(10).font_bold().text_color("#ffffff").child("!"));
  }
  return frame.child(svg(`mods/linear-board/priority-${PRIORITY_ICONS[issue.priority] ?? "none"}.svg`).size(14).text_color(t.muted));
}

const labelPill = (label, t) => pill(t).px(8).gap(5).text_size(11).text_color(t.muted)
  .child(div().size(8).rounded_full().bg(label.color))
  .child(label.name);

function agentButton(issue, t) {
  return div().id("agent").absolute().right(8).bottom(8).px(8).h(22).flex().items_center().rounded(6)
    .text_size(11).text_color(t.muted).bg(t.raised).border_1().border_color(t.border).hover((s) => s.bg(t.background).text_color(t.foreground))
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); startAgent(issue); }).child("Agent");
}

export class Card extends View {
  init(props) { this.issue = props.issue; }

  update(props) { this.issue = props.issue; }

  render() {
    const t = theme(), issue = this.issue;
    const parent = issue.parent ? issue.parent.title ?? issue.parent.identifier : null;
    return v_flex().id("card").relative().flex_none().w_full().px(12).py(10).gap(6).rounded(CARD_RADIUS).overflow_hidden().cursor_pointer()
      .bg(t.raised).border_1().border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover)).on_click(() => openUrl(issue.url))
      .child(h_flex().flex_none().gap(5).items_center().text_size(11.5).text_color(t.dim)
        .child(div().flex_none().child(issue.identifier))
        .when(Boolean(parent), (e) => e.child(div().flex_none().child("›")).child(div().flex_1().min_w(0).truncate().child(parent))))
      .child(h_flex().flex_none().min_h(TITLE_HEIGHT).gap(7).items_start()
        .child(div().flex_none().pt(2).child(stateIcon(stateKind(issue))))
        .child(div().flex_1().min_w(0).text_size(13).child(issue.title)))
      .child(h_flex().flex_none().gap(5).items_center().overflow_hidden()
        .child(priorityPill(issue, t))
        .children(issue.labels.slice(0, LABEL_LIMIT).map((l) => labelPill(l, t))))
      .child(div().flex_none().text_size(11.5).text_color(t.dim).child(`Created ${shortDate(issue.createdAt)}`))
      .child(agentButton(issue, t));
  }
}
