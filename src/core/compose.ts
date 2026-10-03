// Composition (spec §2.12): the root file and the files its mount rows mount, joined into one tree.
// Each file is read once, as itself, and cached by the analyzer; this module only joins the reads.
// A mount row's children are its own children in its file, then the mounted file's roots.

import type { Row, RowsDocument } from 'rows';
import type { Bindings } from './bindings';
import type { Diagnostic, ItemNode, Node, Tree } from './types';

/** One file read by its own profile: what the analyzer caches by text. */
export interface FileRead {
  text: string;
  doc: RowsDocument;
  tree: Tree;
  bindings: Bindings;
  /** readTree's, the vocabulary's and the tab conversions, without `file`. */
  diagnostics: Diagnostic[];
}

/** A file in the composed tree: its read, and its lines with this analysis's item nodes. */
export interface ComposedFile {
  read: FileRead;
  lines: Node[];
  /** Each row's item node in this analysis. */
  nodes: Map<Row, ItemNode>;
}

export interface Mounts {
  /** Gathered texts by resolved path; null for a file that can't be read. Absent when the workspace can't read other files. */
  files?: ReadonlyMap<string, string | null>;
  /** The workspace's resolve: a path relative to a file; throws, with a plain reason, outside the folder. */
  resolve?: (from: string, ref: string) => string;
}

export interface Composed {
  roots: ItemNode[];
  /** The root first, then each mounted file in composed order. */
  files: Map<string, ComposedFile>;
  /** The mount diagnostics, each on its mount row in the file that holds it. */
  diagnostics: Diagnostic[];
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Why a mount can't show its file (spec §2.12), as the mount diagnostics and the grid's mount picker both say it. */
export const mountWhy = {
  loop: (path: string) => `${path} mounts this file, directly or through other files`,
  overlap: (path: string) => `${path} is already mounted elsewhere in the plan`,
};

/**
 * Joins the root file with what it mounts, depth first in document order. Every item node is a
 * fresh copy for this analysis, so a cached read is never changed and a model never changes
 * under its holder. A file is shown once: the first mount of it in composed order wins.
 */
export function compose(rootPath: string, root: FileRead, mounts: Mounts, readFile: (path: string, text: string) => FileRead): Composed {
  const files = new Map<string, ComposedFile>();
  const diagnostics: Diagnostic[] = [];

  /** Copies a file's items for this analysis; its own hierarchy comes from the rows parent relation. */
  const show = (path: string, read: FileRead): ItemNode[] => {
    const nodes = new Map<Row, ItemNode>();
    const lines = read.tree.nodes.map((node): Node => {
      if (node.kind !== 'item') return node;
      const copy: ItemNode = { ...node, children: [], outlineNumber: '', done: false, file: path };
      nodes.set(node.row, copy);
      return copy;
    });
    for (const [row, node] of nodes) node.children = row.children.map((child) => nodes.get(child)!);
    files.set(path, { read, lines, nodes });
    return read.tree.items.map((item) => nodes.get(item.row)!);
  };

  /** `chain` is the files from the root down to the node's own, which is last. */
  const mount = (node: ItemNode, chain: string[]): void => {
    const target = node.row.mount!;
    const say = (severity: Diagnostic['severity'], code: string, text: string): void =>
      void diagnostics.push({
        line: node.line,
        span: { from: target.pathFrom, to: target.partTo ?? target.pathTo },
        severity,
        code,
        message: text,
        ...(node.file === rootPath ? {} : { file: node.file }),
      });
    if (target.part !== undefined) return say('info', 'mount-part-unsupported', `mounting part of a file (#${target.part}) comes later; this mount shows nothing for now`);
    if (!mounts.files || !mounts.resolve) return say('info', 'mount-needs-folder', 'Open the folder to see mounted plans.');
    let path: string;
    try {
      path = mounts.resolve(node.file, target.path);
    } catch (e) {
      return say('error', 'mount-outside', message(e));
    }
    node.mount = path;
    if (chain.includes(path)) return say('error', 'mount-loop', `${mountWhy.loop(path)}; this mount shows nothing`);
    if (files.has(path)) return say('warning', 'mount-overlap', `${mountWhy.overlap(path)}; this mount shows nothing`);
    const text = mounts.files.get(path);
    // Not gathered yet: it shows once it is, with nothing to report meanwhile.
    if (text === undefined) return;
    if (text === null) return say('warning', 'mount-missing', `${path} isn't in the folder, or can't be read`);
    const roots = show(path, readFile(path, text));
    node.composes = path;
    node.children.push(...roots);
    roots.forEach((r) => visit(r, [...chain, path]));
  };

  // Own children first, then the mount, so composed order is document order within each file.
  const visit = (node: ItemNode, chain: string[]): void => {
    for (const child of [...node.children]) visit(child, chain);
    if (node.row.mount) mount(node, chain);
  };

  const roots = show(rootPath, root);
  roots.forEach((r) => visit(r, [rootPath]));

  // Outline numbers and inherited done run across the composed tree: a mount row is an ordinary parent.
  const number = (list: ItemNode[], prefix: string, inheritedDone: boolean): void =>
    list.forEach((item, i) => {
      item.outlineNumber = `${prefix}${i + 1}`;
      item.done = inheritedDone || item.ownDone;
      number(item.children, `${item.outlineNumber}.`, item.done);
    });
  number(roots, '', false);
  return { roots, files, diagnostics };
}
