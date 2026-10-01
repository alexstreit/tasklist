// The Gantt chart (spec §5.5). It follows the editor's rows (spec §3.3): it draws from the leader's
// layout, or from its own natural layout when nothing leads, and only when the layout's version is
// the model's. A new model redraws it; a new layout only repositions its rows. Every position
// comes from ganttGeometry; this file places what that returns.

import type { ItemNode, Model, RenderContext, Renderer, RowLayout, WorkHours } from '../../../../core';
import { formatDate } from '../../../../ui/dates';
import { naturalLayout } from '../../../../ui/row-layout';
import { today } from '../../../../ui/today';
import { critical, deadline, duration, finish, late, milestone, projectFinish, slack, start } from '../../fields';
import { formatDays } from '../table';
import { ganttGeometry } from './geometry';
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
  /** The current row elements, by line. */
  rows: Map<number, HTMLDivElement>;
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
  const state: State = { root, scale, scaleInner, body, canvas, rows: new Map(), model: null, ctx: null, layout: null, drawn: null };
  body.addEventListener('scroll', () => {
    // The scale scrolls sideways with the body; up and down is the leader's to sync.
    scaleInner.style.transform = `translateX(${-body.scrollLeft}px)`;
    state.ctx?.reportScroll?.(body.scrollTop);
  });
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
  canvas.replaceChildren();
  canvas.style.width = `${chart.width}px`;
  for (const week of chart.weeks) line('gantt-line gantt-week-line', week.x, canvas);
  for (const due of chart.deadlines) line('gantt-line gantt-deadline', due.x, canvas);
  line('gantt-line gantt-finish', chart.finish, canvas);
  if (chart.today !== undefined) line('gantt-line gantt-today', chart.today, canvas);
  state.rows.clear();
}

/** One row: its band, which takes clicks and the cursor highlight, and its marks. */
function drawRow(model: Model, node: ItemNode, row: GanttRow, ctx: RenderContext): HTMLDivElement {
  const band = div('gantt-row');
  band.dataset.line = String(row.line);
  band.classList.toggle('done', row.done);
  band.addEventListener('click', () => ctx.setCursorLine(row.line));
  const mark = div(`gantt-${row.mark.kind}`, band);
  mark.style.left = `${row.mark.x}px`;
  if ('width' in row.mark) mark.style.width = `${row.mark.width}px`;
  mark.classList.toggle('critical', row.critical);
  mark.classList.toggle('late', row.late);
  mark.title = tooltip(model, node);
  if (row.pinX !== undefined) div('gantt-pin', band).style.left = `${row.pinX}px`;
  if (row.deadlineX !== undefined) div('gantt-deadline-marker', band).style.left = `${row.deadlineX}px`;
  return band;
}

function markCursor(state: State): void {
  const cursor = state.ctx?.cursorItem;
  for (const [line, band] of state.rows) {
    band.classList.toggle('at-cursor', cursor?.line === line && cursor.exact);
    band.classList.toggle('near-cursor', cursor?.line === line && !cursor.exact);
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
  const items = new Map<number, ItemNode>();
  const collect = (node: ItemNode): void => void (items.set(node.line, node), node.children.forEach(collect));
  model.roots.forEach(collect);
  const shown = new Set<number>();
  for (const row of chart.rows) {
    shown.add(row.line);
    let band = state.rows.get(row.line);
    if (!band) {
      band = drawRow(model, items.get(row.line)!, row, ctx);
      state.rows.set(row.line, band);
      canvas.append(band);
    }
    band.style.top = `${row.top}px`;
    band.style.height = `${row.height}px`;
  }
  for (const [line, band] of state.rows) {
    if (shown.has(line)) continue;
    band.remove();
    state.rows.delete(line);
  }
  state.drawn = model;
  markCursor(state);
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
    if (current.drawn !== model) draw(current);
    markCursor(current);
  },
};
