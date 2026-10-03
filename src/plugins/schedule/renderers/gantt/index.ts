// The Gantt chart (spec §5.5). It follows the editor's rows (spec §3.3): it draws from the leader's
// layout, or from its own natural layout when nothing leads, and only when the layout's version is
// the model's. A new model or a new scale redraws it; a new layout only repositions its rows.
// Every position comes from ganttGeometry; this file places what that returns. From the bottom
// up, the canvas holds the cursor and hover bands, the period lines, the marks, then the deadline,
// finish and today lines. The scale picker, in the preview toolbar, chooses Day, Week, Month or Fit.

import type { FileLine, ItemNode, Model, RenderContext, Renderer, RowLayout, Visible, WorkHours } from '../../../../core';
import { formatDate, formatPinnableDate } from '../../../../core';
import { naturalLayout } from '../../../../ui/row-layout';
import { today } from '../../../../ui/today';
import { critical, deadline, duration, finish, late, milestone, projectFinish, slack, start } from '../../fields';
import { formatDays } from '../table';
import { ganttGeometry, rowKey } from './geometry';
import type { Gantt, GanttRow, Scale } from './geometry';
import './gantt.css';

/** The date scale: a row of deadline labels (and the picker), over the two tiers of labels. The
 *  same at every scale. */
const SCALE_HEIGHT = 54;

type ScaleName = Exclude<Scale, object>;
const SCALES: [ScaleName, string][] = [
  ['day', 'Day'],
  ['week', 'Week'],
  ['month', 'Month'],
  ['fit', 'Fit'],
];
// Which scale was last chosen. A per-viewer convenience, like the last-used editor: it may be
// unavailable (private browsing), and nothing depends on it.
const SCALE_KEY = 'plan.gantt-scale';

function lastScale(): ScaleName {
  try {
    return SCALES.find(([id]) => id === localStorage.getItem(SCALE_KEY))?.[0] ?? 'fit';
  } catch {
    return 'fit';
  }
}
/** When `--row-height` can't be read (no stylesheet, as in tests). */
const ROW_HEIGHT = 22;

interface State {
  root: HTMLDivElement;
  scale: HTMLDivElement;
  scaleInner: HTMLDivElement;
  picker: HTMLDivElement;
  /** Takes the picker out of the toolbar; null while it isn't there. */
  unplace: (() => void) | null;
  body: HTMLDivElement;
  canvas: HTMLDivElement;
  /** The layers the rows go in: their bands, and their marks above the week lines. */
  bandLayer: HTMLDivElement;
  markLayer: HTMLDivElement;
  /** The current bands, by rowKey: every layout row with a line, each with its `data-file` and `data-line`. */
  bands: Map<string, HTMLDivElement>;
  /** The current mark rows, by rowKey: the items among them. */
  rows: Map<string, HTMLDivElement>;
  /** The line hovered here, and the one hovered in the other pane; a render replays only the second. */
  hover: FileLine | null;
  relayed: FileLine | null;
  model: Model | null;
  ctx: RenderContext | null;
  /** The leader's latest layout; null while nothing leads. */
  layout: RowLayout | null;
  /** The model the chart was last drawn from, the filter it was drawn with, and the chart. */
  drawn: Model | null;
  filter: Visible | null;
  chart: Gantt | null;
  zoom: ScaleName;
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
  const picker = div('gantt-zoom');
  const body = div('gantt-body', root);
  const canvas = div('gantt-canvas', body);
  host.replaceChildren(root);
  const state: State = {
    root,
    scale,
    scaleInner,
    picker,
    unplace: null,
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
    filter: null,
    chart: null,
    zoom: lastScale(),
  };
  drawPicker(state);
  body.addEventListener('scroll', () => {
    slideScale(state);
    state.ctx?.reportScroll?.(body.scrollTop);
  });
  // Fit follows the pane's width. jsdom has no ResizeObserver.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => state.zoom === 'fit' && draw(state)).observe(body);
  // Anywhere on a row, its band or its marks, is hovering its line; anywhere else is none.
  const hovered = (at: FileLine | null) => {
    if (same(at, state.hover)) return;
    state.hover = at;
    markHover(state);
    state.ctx?.setHoverLine?.(at);
  };
  canvas.addEventListener('mouseover', (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-line]');
    hovered(row ? lineOf(row) : null);
  });
  body.addEventListener('mouseleave', () => hovered(null));
  return state;
}

/** The scale scrolls sideways with the body; up and down is the leader's to sync. */
function slideScale(state: State): void {
  state.scaleInner.style.transform = `translateX(${-state.body.scrollLeft}px)`;
}

/** The segmented control: a radio group, one tab stop, arrow keys moving between the options. */
function drawPicker(state: State): void {
  const { picker } = state;
  picker.setAttribute('role', 'radiogroup');
  picker.setAttribute('aria-label', 'Scale');
  const buttons = SCALES.map(([id, label]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'radio');
    button.dataset.scale = id;
    button.textContent = label;
    button.addEventListener('click', () => setScale(state, id));
    return button;
  });
  picker.replaceChildren(...buttons);
  picker.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const at = SCALES.findIndex(([id]) => id === state.zoom);
    const next = (at + step + SCALES.length) % SCALES.length;
    setScale(state, SCALES[next][0]);
    buttons[next].focus();
  });
  markScale(state);
}

function markScale(state: State): void {
  for (const button of state.picker.querySelectorAll<HTMLButtonElement>('button')) {
    const on = button.dataset.scale === state.zoom;
    button.setAttribute('aria-checked', String(on));
    button.tabIndex = on ? 0 : -1;
  }
}

/** Switch scales, keeping the date at the left edge there; Fit shows everything, so it starts at 0. */
function setScale(state: State, scale: ScaleName): void {
  if (scale === state.zoom) return;
  const left = state.chart ? state.body.scrollLeft / state.chart.dayWidth : 0;
  state.zoom = scale;
  try {
    localStorage.setItem(SCALE_KEY, scale);
  } catch {
    // Storage is not available; the Gantt just opens at Fit next time.
  }
  markScale(state);
  draw(state);
  if (state.chart) state.body.scrollLeft = scale === 'fit' ? 0 : left * state.chart.dayWidth;
  slideScale(state);
}

/** The tooltip: title, start and finish dates, duration and slack, as the schedule table shows them. */
function tooltip(model: Model, node: ItemNode): string {
  const calendar = model.calendar!;
  const date = (t: WorkHours, edge: 'start' | 'end') => formatDate(calendar.toDate(t, edge), calendar);
  const begins = model.get(node, start)!;
  const ends = model.get(node, finish)!;
  const point = model.get(node, milestone)!;
  const from = formatPinnableDate(begins.effective, begins.edge, calendar);
  const span = point ? 'milestone' : model.get(node, duration) ? formatDays(model.get(node, duration)!.effective, calendar.hoursPerDay) : null;
  return [
    node.title,
    point ? from : `${from} – ${date(ends, 'end')}`,
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
  scaleInner.style.width = `${chart.width}px`;
  // Three rows: the deadlines' dates, then the top tier, then the bottom tier and its ticks.
  const deadlines = div('gantt-scale-deadlines');
  const top = div('gantt-scale-top');
  const bottom = div('gantt-scale-bottom');
  scaleInner.replaceChildren(deadlines, top, bottom);
  for (const due of chart.deadlines) {
    const label = div('gantt-deadline-label', deadlines);
    label.style.left = `${due.x}px`;
    label.textContent = due.label;
  }
  for (const period of chart.top) {
    const label = div('gantt-top', top);
    label.style.left = `${period.x}px`;
    label.textContent = period.label;
  }
  for (const x of chart.ticks) line('gantt-tick', x, bottom);
  for (const period of chart.bottom) {
    const label = div('gantt-bottom', bottom);
    label.style.left = `${period.x}px`;
    // A day's letter is centred in its day.
    if (chart.tiers === 'day') label.style.width = `${chart.dayWidth}px`;
    label.classList.toggle('centred', chart.tiers === 'day');
    label.textContent = period.label;
  }
  canvas.replaceChildren(state.bandLayer);
  canvas.style.width = `${chart.width}px`;
  for (const x of chart.lines) line('gantt-line gantt-period-line', x, canvas);
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
  if (row.file !== model.file) marks.classList.add('mounted');
  marks.dataset.file = row.file;
  marks.dataset.line = String(row.line);
  marks.addEventListener('click', () => ctx.setCursorLine({ file: row.file, line: row.line }));
  const mark = div(`gantt-${row.mark.kind}`, marks);
  mark.style.left = `${row.mark.x}px`;
  if ('drawn' in row.mark) mark.style.width = `${row.mark.drawn}px`;
  if (row.mark.kind === 'summary' && row.mark.asBar) mark.classList.add('as-bar');
  mark.classList.toggle('critical', row.critical);
  mark.classList.toggle('late', row.late);
  mark.title = tooltip(model, node);
  if (row.pinX !== undefined) div('gantt-pin', marks).style.left = `${row.pinX}px`;
  if (row.deadlineX !== undefined) div('gantt-deadline-marker', marks).style.left = `${row.deadlineX}px`;
  return marks;
}

/** The file and line a band or mark row is on. */
const lineOf = (el: HTMLElement): FileLine => ({ file: el.dataset.file!, line: Number(el.dataset.line) });
const same = (a: FileLine | null | undefined, b: FileLine | null | undefined): boolean => (a ?? null) === (b ?? null) || (!!a && !!b && a.file === b.file && a.line === b.line);

function markCursor(state: State): void {
  const cursor = state.ctx?.cursorItem;
  for (const band of state.bands.values()) {
    const on = same(lineOf(band), cursor);
    band.classList.toggle('at-cursor', on && cursor!.exact);
    band.classList.toggle('near-cursor', on && !cursor!.exact);
  }
}

function markHover(state: State): void {
  const hovered = state.hover ?? state.relayed;
  for (const band of state.bands.values()) band.classList.toggle('hover', hovered !== null && same(lineOf(band), hovered));
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
  const filter = ctx.filter ?? null;
  const layout = state.layout ?? naturalLayout(model, model.version, { bodyTop: SCALE_HEIGHT, scrollTop: 0, height: Infinity, rowHeight }, filter);
  // A layout of another version is of other text: keep the last frame.
  if (layout.version !== model.version) return;
  const chart = ganttGeometry(model, layout, state.zoom, today(), body.clientWidth);
  if (state.drawn !== model || state.chart?.dayWidth !== chart.dayWidth || state.chart.tiers !== chart.tiers) drawChart(state, chart);
  state.chart = chart;

  scale.style.height = `${layout.bodyTop}px`;
  body.style.top = `${layout.bodyTop}px`;
  canvas.style.height = `${layout.contentHeight}px`;
  const items = new Map<string, ItemNode>();
  const collect = (node: ItemNode): void => void (items.set(rowKey(node), node), node.children.forEach(collect));
  model.roots.forEach(collect);
  place(chart.bands, state.bands, state.bandLayer, (band) => {
    const el = div('gantt-band');
    if (band.file !== model.file) el.classList.add('mounted');
    el.dataset.file = band.file;
    el.dataset.line = String(band.line);
    return el;
  });
  place(chart.rows, state.rows, state.markLayer, (row) => drawRow(model, items.get(rowKey(row))!, row, ctx));
  // An ancestor the filter shows only for context is dimmed.
  for (const row of state.rows.values()) row.classList.toggle('filter-context', !!filter?.dims(lineOf(row)));
  state.drawn = model;
  state.filter = filter;
  markCursor(state);
  markHover(state);
  if (body.scrollTop !== layout.scrollTop) body.scrollTop = layout.scrollTop;
}

export const ganttRenderer: Renderer = {
  id: 'gantt',
  label: 'Gantt',
  requires: [start, duration, finish, slack, critical, late, milestone, deadline, projectFinish],
  follows: true,
  rank: 20,

  render(model: Model, host: HTMLElement, ctx: RenderContext): void {
    let state = states.get(host);
    if (!state || !host.contains(state.root)) {
      // A chart mounted afresh takes its old picker with it.
      state?.unplace?.();
      state = mount(host);
      states.set(host, state);
    }
    const current = state;
    current.model = model;
    current.ctx = ctx;
    if (!current.picker.isConnected) current.unplace = ctx.toolbar?.(current.picker) ?? null;
    ctx.reportHeaderHeight?.(SCALE_HEIGHT);
    // Replays the latest layout at once, which draws when its version is the model's.
    ctx.onRowLayout?.((layout) => {
      current.layout = layout;
      draw(current);
    });
    ctx.onHoverLine?.((at) => {
      current.relayed = at;
      markHover(current);
    });
    if (current.drawn !== model || current.filter !== (ctx.filter ?? null)) draw(current);
    markCursor(current);
  },
};
