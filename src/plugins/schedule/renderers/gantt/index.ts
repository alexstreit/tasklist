// The Gantt chart (spec §5.5). It follows the editor's rows (spec §3.3): it draws from the leader's
// layout, or from its own natural layout when nothing leads, and only when the layout's version is
// the model's. A new model redraws it; a new layout only repositions its rows. Every position
// comes from ganttGeometry; this file places what that returns. From the bottom up, the canvas
// holds the cursor and hover bands, the week lines, the marks, then the deadline, finish and
// today lines.

import type { ItemNode, Model, RenderContext, Renderer, RowLayout, WorkHours } from '../../../../core';
import { formatDate } from '../../../../ui/dates';
import { naturalLayout } from '../../../../ui/row-layout';
import { today } from '../../../../ui/today';
import { critical, deadline, duration, finish, late, milestone, projectFinish, slack, start } from '../../fields';
import { formatDays } from '../table';
import { ganttGeometry, rowKey } from './geometry';
import type { Gantt, GanttRow } from './geometry';
import './gantt.css';

/** Fixed for now; zoom comes later. */
const DAY_WIDTH = 24;
/** The date scale: a row of week labels over a row of day letters. */
const SCALE_HEIGHT = 40;
/** When `--row-height` can't be read (no stylesheet, as in tests). */
const ROW_HEIGHT = 22;

interface State {
  root: HTMLDivElement;
  scale: HTMLDivElement;
  scaleInner: HTMLDivElement;
  body: HTMLDivElement;
  canvas: HTMLDivElement;
  /** The layers the rows go in: their bands, and their marks above the week lines. */
  bandLayer: HTMLDivElement;
  markLayer: HTMLDivElement;
  /** The current bands, by rowKey: every layout row with a line. Only the root file's carry `data-line`. */
  bands: Map<string, HTMLDivElement>;
  /** The current mark rows, by rowKey: the items among them. */
  rows: Map<string, HTMLDivElement>;
  /** The line hovered here, and the one hovered in the other pane; a render replays only the second. */
  hover: number | null;
  relayed: number | null;
  model: Model | null;
  ctx: RenderContext | null;
  /** The leader's latest layout; null while nothing leads. */
  layout: RowLayout | null;
  /** The model the chart was last drawn from. */
  drawn: Model | null;
}

const states = new WeakMap<HTMLElement, State>();

function div(className: string, parent?: HTMLElement): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  parent?.append(el);
  return el;
}

function mount(host: HTMLElement): State {
  const root = div('gantt');
  const scale = div('gantt-scale', root);
  const scaleInner = div('gantt-scale-inner', scale);
  const body = div('gantt-body', root);
  const canvas = div('gantt-canvas', body);
  host.replaceChildren(root);
  const state: State = {
    root,
    scale,
    scaleInner,
    body,
    canvas,
    bandLayer: div('gantt-layer'),
    markLayer: div('gantt-layer'),
    bands: new Map(),
    rows: new Map(),
    hover: null,
    relayed: null,
    model: null,
    ctx: null,
    layout: null,
    drawn: null,
  };
  body.addEventListener('scroll', () => {
    // The scale scrolls sideways with the body; up and down is the leader's to sync.
    scaleInner.style.transform = `translateX(${-body.scrollLeft}px)`;
    state.ctx?.reportScroll?.(body.scrollTop);
  });
  // Anywhere on a row, its band or its marks, is hovering its line; anywhere else is none.
  const hovered = (line: number | null) => {
    if (line === state.hover) return;
    state.hover = line;
    markHover(state);
    state.ctx?.setHoverLine?.(line);
  };
  canvas.addEventListener('mouseover', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-line]');
    hovered(row ? Number(row.dataset.line) : null);
  });
  body.addEventListener('mouseleave', () => hovered(null));
  return state;
}

/** The tooltip: title, start and finish dates, duration and slack, as the schedule table shows them. */
function tooltip(model: Model, node: ItemNode): string {
  const calendar = model.calendar!;
  const date = (t: WorkHours, edge: 'start' | 'end') => formatDate(calendar.toDate(t, edge), calendar);
  const ends = model.get(node, finish)!;
  const point = model.get(node, milestone)!;
  const span = point ? 'milestone' : model.get(node, duration) ? formatDays(model.get(node, duration)!.effective, calendar.hoursPerDay) : null;
  return [
    node.title,
    point ? date(ends, 'end') : `${date(model.get(node, start)!.effective, 'start')} – ${date(ends, 'end')}`,
    ...(span ? [span] : []),
    `slack ${formatDays(model.get(node, slack)!, calendar.hoursPerDay)}`,
  ].join('\n');
}

function line(className: string, x: number, parent: HTMLElement): void {
  div(className, parent).style.left = `${x}px`;
}

/** The scale and the full-height lines: everything that changes only with the model. */
function drawChart(state: State, chart: Gantt): void {
  const { scaleInner, canvas } = state;
  scaleInner.replaceChildren();
  scaleInner.style.width = `${chart.width}px`;
  for (const week of chart.weeks) {
    const label = div('gantt-week', scaleInner);
    label.style.left = `${week.x}px`;
    label.textContent = week.label;
  }
  for (const day of chart.days) {
    const letter = div('gantt-day', scaleInner);
    letter.style.left = `${day.x}px`;
    letter.style.width = `${DAY_WIDTH}px`;
    letter.textContent = day.letter;
  }
  for (const due of chart.deadlines) {
    const label = div('gantt-deadline-label', scaleInner);
    label.style.left = `${due.x}px`;
    label.textContent = due.label;
  }
  canvas.replaceChildren(state.bandLayer);
  canvas.style.width = `${chart.width}px`;
  for (const week of chart.weeks) line('gantt-line gantt-week-line', week.x, canvas);
  canvas.append(state.markLayer);
  for (const due of chart.deadlines) line('gantt-line gantt-deadline', due.x, canvas);
  line('gantt-line gantt-finish', chart.finish, canvas);
  if (chart.today !== undefined) line('gantt-line gantt-today', chart.today, canvas);
  state.bandLayer.replaceChildren();
  state.markLayer.replaceChildren();
  state.bands.clear();
  state.rows.clear();
}

/** One item's marks, on a full-width row that takes its clicks. Its band is drawn apart, below the week lines. */
function drawRow(model: Model, node: ItemNode, row: GanttRow, ctx: RenderContext): HTMLDivElement {
  const marks = div('gantt-row');
  marks.classList.toggle('done', row.done);
  // A mounted row's line is in another file: no cursor, hover or click-to-line for it.
  if (row.file === model.file) {
    marks.dataset.line = String(row.line);
    marks.addEventListener('click', () => ctx.setCursorLine(row.line));
  } else marks.classList.add('mounted');
  const mark = div(`gantt-${row.mark.kind}`, marks);
  mark.style.left = `${row.mark.x}px`;
  if ('width' in row.mark) mark.style.width = `${row.mark.width}px`;
  mark.classList.toggle('critical', row.critical);
  mark.classList.toggle('late', row.late);
  mark.title = tooltip(model, node);
  if (row.pinX !== undefined) div('gantt-pin', marks).style.left = `${row.pinX}px`;
  if (row.deadlineX !== undefined) div('gantt-deadline-marker', marks).style.left = `${row.deadlineX}px`;
  return marks;
}

/** A band's line, when it is the root file's; a mounted row's band is never the cursor's or hovered. */
const bandLine = (band: HTMLDivElement): number | null => (band.dataset.line === undefined ? null : Number(band.dataset.line));

function markCursor(state: State): void {
  const cursor = state.ctx?.cursorItem;
  for (const band of state.bands.values()) {
    const line = bandLine(band);
    band.classList.toggle('at-cursor', line !== null && cursor?.line === line && cursor.exact);
    band.classList.toggle('near-cursor', line !== null && cursor?.line === line && !cursor.exact);
  }
}

function markHover(state: State): void {
  const hovered = state.hover ?? state.relayed;
  for (const band of state.bands.values()) {
    const line = bandLine(band);
    band.classList.toggle('hover', line !== null && line === hovered);
  }
}

/** Place an element per entry of `wanted` in `layer`, by rowKey: keep and move those already there, make the new ones, remove the rest. */
function place<T extends { line: number; file: string; top: number; height: number }>(
  wanted: T[],
  current: Map<string, HTMLDivElement>,
  layer: HTMLDivElement,
  make: (row: T) => HTMLDivElement,
): void {
  const shown = new Set<string>();
  for (const row of wanted) {
    const key = rowKey(row);
    shown.add(key);
    let el = current.get(key);
    if (!el) {
      el = make(row);
      current.set(key, el);
      layer.append(el);
    }
    el.style.top = `${row.top}px`;
    el.style.height = `${row.height}px`;
  }
  for (const [key, el] of current) {
    if (shown.has(key)) continue;
    el.remove();
    current.delete(key);
  }
}

/** Draw against the current layout: in full on a new model, otherwise only placing the rows. */
function draw(state: State): void {
  const { model, ctx, body, canvas, scale } = state;
  if (!model || !ctx) return;
  const rowHeight = parseFloat(getComputedStyle(state.root).getPropertyValue('--row-height')) || ROW_HEIGHT;
  const layout = state.layout ?? naturalLayout(model, model.version, { bodyTop: SCALE_HEIGHT, scrollTop: 0, height: Infinity, rowHeight });
  // A layout of another version is of other text: keep the last frame.
  if (layout.version !== model.version) return;
  const chart = ganttGeometry(model, layout, DAY_WIDTH, today());
  if (state.drawn !== model) drawChart(state, chart);

  scale.style.height = `${layout.bodyTop}px`;
  body.style.top = `${layout.bodyTop}px`;
  canvas.style.height = `${layout.contentHeight}px`;
  const items = new Map<string, ItemNode>();
  const collect = (node: ItemNode): void => void (items.set(rowKey(node), node), node.children.forEach(collect));
  model.roots.forEach(collect);
  place(chart.bands, state.bands, state.bandLayer, (band) => {
    const el = div('gantt-band');
    if (band.file === model.file) el.dataset.line = String(band.line);
    else el.classList.add('mounted');
    return el;
  });
  place(chart.rows, state.rows, state.markLayer, (row) => drawRow(model, items.get(rowKey(row))!, row, ctx));
  state.drawn = model;
  markCursor(state);
  markHover(state);
  if (body.scrollTop !== layout.scrollTop) body.scrollTop = layout.scrollTop;
}

export const ganttRenderer: Renderer = {
  id: 'gantt',
  label: 'Gantt',
  requires: [start, duration, finish, slack, critical, late, milestone, deadline, projectFinish],
  follows: true,

  render(model: Model, host: HTMLElement, ctx: RenderContext): void {
    let state = states.get(host);
    if (!state || !host.contains(state.root)) {
      state = mount(host);
      states.set(host, state);
    }
    const current = state;
    current.model = model;
    current.ctx = ctx;
    ctx.reportHeaderHeight?.(SCALE_HEIGHT);
    // Replays the latest layout at once, which draws when its version is the model's.
    ctx.onRowLayout?.((layout) => {
      current.layout = layout;
      draw(current);
    });
    ctx.onHoverLine?.((line) => {
      current.relayed = line;
      markHover(current);
    });
    if (current.drawn !== model) draw(current);
    markCursor(current);
  },
};
