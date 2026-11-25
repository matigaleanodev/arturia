/**
 * Safe Markdown for Arturia's replies. The parser turns text into a small tree that templates render with
 * interpolation only: there is no HTML string, no innerHTML and no way for the source to add elements,
 * attributes, styles or scripts. Raw HTML stays literal text, and links keep only absolute http, https and
 * mailto URLs. Unclosed constructs stay readable while a reply is streaming.
 */

export type Inline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'break' }
  | { readonly type: 'strong' | 'em' | 'del'; readonly children: readonly Inline[] }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly children: readonly Inline[] }
  | { readonly type: 'paragraph'; readonly children: readonly Inline[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly (readonly Block[])[] }
  | { readonly type: 'code'; readonly lang: string; readonly text: string }
  | { readonly type: 'quote'; readonly children: readonly Block[] }
  | {
    readonly type: 'table';
    readonly align: readonly Align[];
    readonly head: readonly (readonly Inline[])[];
    readonly rows: readonly (readonly (readonly Inline[])[])[];
  }
  | { readonly type: 'rule' };

const MAX_BLOCK_DEPTH = 8;
const MAX_INLINE_DEPTH = 12;
const LABEL_LIMIT = 1_000;
const URL_LIMIT = 2_048;

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** Returns the normalized URL when it is an absolute http, https or mailto URL without credentials. */
export function safeHref(raw: string): string | null {
  if (!raw || raw.length > URL_LIMIT || /[\s\u0000-\u001f\u007f]/.test(raw)) return null;
  if (!/^(?:https?:\/\/|mailto:)/i.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return SAFE_PROTOCOLS.has(url.protocol) && !url.username && !url.password ? url.href : null;
}

// ---------- Blocks ----------

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const DELIMITER_CELL = /^:?-+:?$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length)));
  return parseBlocks(lines, 0);
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function startsBlock(lines: readonly string[], index: number, depth: number): boolean {
  const line = lines[index]!;
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) ||
    (depth < MAX_BLOCK_DEPTH && (QUOTE.test(line) || LIST_ITEM.test(line))) ||
    isTableStart(lines, index);
}

function parseBlocks(lines: readonly string[], depth: number): Block[] {
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (isBlank(line)) {
      index++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const [, indent, marker] = fence as unknown as [string, string, string, string];
      const content: string[] = [];
      index++;
      while (index < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[index]!);
        if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) {
          index++;
          break;
        }
        const current = lines[index]!;
        content.push(current.slice(Math.min(indent.length, indentOf(current))));
        index++;
      }
      blocks.push({ type: 'code', lang: fence[3] ?? '', text: content.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, children: parseInline((heading[2] ?? '').trim()) });
      index++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      index++;
      continue;
    }

    if (depth < MAX_BLOCK_DEPTH && QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index]!)) {
        quoted.push(lines[index]!.replace(/^ {0,3}> ?/, ''));
        index++;
      }
      blocks.push({ type: 'quote', children: parseBlocks(quoted, depth + 1) });
      continue;
    }

    if (isTableStart(lines, index)) {
      const [table, next] = parseTable(lines, index, depth);
      blocks.push(table);
      index = next;
      continue;
    }

    if (depth < MAX_BLOCK_DEPTH && LIST_ITEM.test(line)) {
      const [list, next] = parseList(lines, index, depth);
      blocks.push(list);
      index = next;
      continue;
    }

    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && !isBlank(lines[index]!) && !startsBlock(lines, index, depth)) {
      paragraph.push(lines[index]!.trim());
      index++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

function parseList(lines: readonly string[], start: number, depth: number): [Block, number] {
  const first = LIST_ITEM.exec(lines[start]!)!;
  const ordered = /\d/.test(first[2]!);
  const delimiter = first[2]!.slice(-1);
  const items: Block[][] = [];
  let index = start;

  while (index < lines.length) {
    const item = LIST_ITEM.exec(lines[index]!);
    if (
      !item || RULE.test(lines[index]!) ||
      /\d/.test(item[2]!) !== ordered || item[2]!.slice(-1) !== delimiter
    ) {
      break;
    }
    const markerIndent = item[1]!.length;
    const contentOffset = markerIndent + item[2]!.length + 1;
    const content = [item[3] ?? ''];
    index++;

    while (index < lines.length) {
      const line = lines[index]!;
      if (isBlank(line)) {
        let next = index + 1;
        while (next < lines.length && isBlank(lines[next]!)) next++;
        if (next < lines.length && indentOf(lines[next]!) > markerIndent) {
          content.push(...lines.slice(index, next).map(() => ''));
          index = next;
          continue;
        }
        break;
      }
      if (indentOf(line) > markerIndent) {
        content.push(line.slice(Math.min(indentOf(line), contentOffset)));
        index++;
        continue;
      }
      // A lazy line continues the item's paragraph.
      if (!startsBlock(lines, index, depth)) {
        content.push(line.trim());
        index++;
        continue;
      }
      break;
    }
    items.push(parseBlocks(content, depth + 1));

    let next = index;
    while (next < lines.length && isBlank(lines[next]!)) next++;
    const sibling = next < lines.length ? LIST_ITEM.exec(lines[next]!) : null;
    if (!sibling || sibling[1]!.length > 3 || /\d/.test(sibling[2]!) !== ordered) break;
    index = next;
  }

  const start1 = ordered ? Number.parseInt(first[2]!, 10) : 1;
  return [{ type: 'list', ordered, start: start1, items }, index];
}

function splitCells(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let index = 0; index < row.length; index++) {
    const char = row[index]!;
    if (char === '\\' && index + 1 < row.length) {
      current += char + row[index + 1];
      index++;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableStart(lines: readonly string[], index: number): boolean {
  const header = lines[index]!;
  const delimiter = lines[index + 1];
  if (!header.includes('|') || delimiter === undefined || !delimiter.includes('-')) return false;
  const cells = splitCells(delimiter);
  return cells.every((cell) => DELIMITER_CELL.test(cell)) &&
    (delimiter.includes('|') || cells.length > 1) &&
    cells.length === splitCells(header).length;
}

function parseTable(lines: readonly string[], start: number, depth: number): [Block, number] {
  const head = splitCells(lines[start]!).map((cell) => parseInline(cell));
  const align = splitCells(lines[start + 1]!).map((cell): Align => {
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
  });
  const rows: Inline[][][] = [];
  let index = start + 2;
  while (index < lines.length && !isBlank(lines[index]!) && !startsBlock(lines, index, depth)) {
    const cells = splitCells(lines[index]!).slice(0, head.length).map((cell) => parseInline(cell));
    while (cells.length < head.length) cells.push([]);
    rows.push(cells);
    index++;
  }
  return [{ type: 'table', align, head, rows }, index];
}

// ---------- Inlines ----------

interface InlineOptions {
  /** Bracketed links; disabled inside a link label. */
  readonly links: boolean;
  /** <scheme:…> autolinks and bare URLs. */
  readonly autolinks: boolean;
}

/** Positions from which a search for a closing run already failed, per delimiter and run length. */
type FailedSearches = Map<string, number>;

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD = /[\p{L}\p{N}]/u;
const AUTOLINK = /^<((?:https?:\/\/|mailto:)[^\s<>]*)>/i;
const BARE_URL = /^https?:\/\/[^\s<>]+/i;

export function parseInline(source: string): Inline[] {
  return inline(source, 0, { links: true, autolinks: true });
}

function inline(source: string, depth: number, options: InlineOptions): Inline[] {
  const nodes: Inline[] = [];
  const failed: FailedSearches = new Map();
  let buffer = '';
  const flush = () => {
    if (buffer) nodes.push({ type: 'text', text: buffer });
    buffer = '';
  };

  let index = 0;
  while (index < source.length) {
    const char = source[index]!;

    if (char === '\\' && PUNCTUATION.test(source[index + 1] ?? '')) {
      buffer += source[index + 1];
      index += 2;
      continue;
    }

    if (char === '\n') {
      flush();
      nodes.push({ type: 'break' });
      index++;
      continue;
    }

    if (char === '`') {
      const run = runLength(source, index, '`');
      const close = findCodeClose(source, index + run, run, failed);
      if (close < 0) {
        buffer += source.slice(index, index + run);
        index += run;
        continue;
      }
      let code = source.slice(index + run, close).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
      flush();
      nodes.push({ type: 'code', text: code });
      index = close + run;
      continue;
    }

    if (char === '*' || char === '_' || char === '~') {
      const run = runLength(source, index, char);
      const emphasis = depth < MAX_INLINE_DEPTH ? tryEmphasis(source, index, char, run, failed) : null;
      if (!emphasis) {
        buffer += source.slice(index, index + run);
        index += run;
        continue;
      }
      const children = inline(source.slice(index + run, emphasis), depth + 1, options);
      flush();
      if (char === '~') nodes.push({ type: 'del', children });
      else if (run === 1) nodes.push({ type: 'em', children });
      else if (run === 2) nodes.push({ type: 'strong', children });
      else nodes.push({ type: 'strong', children: [{ type: 'em', children }] });
      index = emphasis + run;
      continue;
    }

    if (char === '!' && source[index + 1] === '[' && depth < MAX_INLINE_DEPTH) {
      const image = tryLink(source, index + 1, failed);
      if (image) {
        // Images are not loaded: the alternative text stands in for them.
        buffer += plainText(inline(image.label, depth + 1, { links: false, autolinks: false }));
        index = image.end;
        continue;
      }
    }

    if (char === '[' && options.links && depth < MAX_INLINE_DEPTH) {
      const link = tryLink(source, index, failed);
      if (link) {
        const children = inline(link.label, depth + 1, { links: true, autolinks: false });
        // A label that contains a link cannot be a link itself.
        if (!containsLink(children)) {
          flush();
          if (link.href) nodes.push({ type: 'link', href: link.href, children });
          else nodes.push(...children);
          index = link.end;
          continue;
        }
      }
    }

    if (char === '<' && options.autolinks) {
      const match = AUTOLINK.exec(source.slice(index, index + URL_LIMIT + 2));
      const href = match ? safeHref(match[1]!) : null;
      if (match && href) {
        flush();
        nodes.push({ type: 'link', href, children: [{ type: 'text', text: match[1]! }] });
        index += match[0].length;
        continue;
      }
    }

    const previous = source[index - 1];
    if ((char === 'h' || char === 'H') && options.autolinks && (previous === undefined || /[\s([{"'*_~<>]/.test(previous))) {
      const bare = bareUrl(source.slice(index, index + URL_LIMIT));
      const href = bare ? safeHref(bare) : null;
      if (bare && href) {
        flush();
        nodes.push({ type: 'link', href, children: [{ type: 'text', text: bare }] });
        index += bare.length;
        continue;
      }
    }

    buffer += char;
    index++;
  }
  flush();
  return mergeText(nodes);
}

function runLength(source: string, index: number, char: string): number {
  let end = index;
  while (source[end] === char) end++;
  return end - index;
}

function findCodeClose(source: string, from: number, run: number, failed: FailedSearches): number {
  const key = '`' + run;
  const failedFrom = failed.get(key);
  if (failedFrom !== undefined && from >= failedFrom) return -1;
  let index = from;
  while (index < source.length) {
    const found = source.indexOf('`', index);
    if (found < 0) break;
    const length = runLength(source, found, '`');
    if (length === run) return found;
    index = found + length;
  }
  failed.set(key, from);
  return -1;
}

/** Returns where the closing run starts, or null when the run cannot open or has no closer. */
function tryEmphasis(source: string, index: number, char: string, run: number, failed: FailedSearches): number | null {
  if (char === '~' ? run !== 2 : run > 3) return null;
  const after = source[index + run];
  if (after === undefined || /\s/.test(after)) return null;
  if (char === '_' && WORD.test(source[index - 1] ?? '')) return null;

  const key = char + run;
  const failedFrom = failed.get(key);
  const from = index + run;
  if (failedFrom !== undefined && from >= failedFrom) return null;

  let position = from;
  while (position < source.length) {
    const current = source[position]!;
    if (current === '\\') {
      position += 2;
      continue;
    }
    if (current === '`') {
      const length = runLength(source, position, '`');
      const close = findCodeClose(source, position + length, length, failed);
      position = close < 0 ? position + length : close + length;
      continue;
    }
    if (current === char) {
      const length = runLength(source, position, char);
      const closes = length === run && position > from && !/\s/.test(source[position - 1]!) &&
        (char !== '_' || !WORD.test(source[position + length] ?? ''));
      if (closes) return position;
      position += length;
      continue;
    }
    position++;
  }
  failed.set(key, from);
  return null;
}

interface LinkMatch {
  readonly label: string;
  readonly href: string | null;
  readonly end: number;
}

function tryLink(source: string, open: number, failed: FailedSearches): LinkMatch | null {
  const limit = Math.min(source.length, open + LABEL_LIMIT);
  let level = 0;
  let close = -1;
  for (let index = open; index < limit; index++) {
    const char = source[index]!;
    if (char === '\\') {
      index++;
    } else if (char === '`') {
      const length = runLength(source, index, '`');
      const end = findCodeClose(source, index + length, length, failed);
      index = (end < 0 ? index + length : end + length) - 1;
    } else if (char === '[') {
      level++;
    } else if (char === ']' && --level === 0) {
      close = index;
      break;
    }
  }
  if (close < 0 || source[close + 1] !== '(') return null;

  let position = close + 2;
  while (source[position] === ' ' || source[position] === '\t') position++;
  let destination: string;
  if (source[position] === '<') {
    const end = source.indexOf('>', position);
    if (end < 0 || end - position > URL_LIMIT || /[\n<]/.test(source.slice(position + 1, end))) return null;
    destination = source.slice(position + 1, end);
    position = end + 1;
  } else {
    const begin = position;
    let parens = 0;
    while (position < source.length && position - begin <= URL_LIMIT) {
      const char = source[position]!;
      if (char === '\\' && PUNCTUATION.test(source[position + 1] ?? '')) {
        position += 2;
        continue;
      }
      if (/[\s\u0000-\u001f]/.test(char)) break;
      if (char === '(') parens++;
      else if (char === ')') {
        if (parens === 0) break;
        parens--;
      }
      position++;
    }
    destination = source.slice(begin, position).replace(/\\([!-/:-@[-`{-~])/g, '$1');
  }

  while (source[position] === ' ' || source[position] === '\t') position++;
  const quote = source[position];
  if (quote === '"' || quote === "'" || quote === '(') {
    const end = source.indexOf(quote === '(' ? ')' : quote, position + 1);
    if (end < 0) return null;
    position = end + 1;
    while (source[position] === ' ' || source[position] === '\t') position++;
  }
  if (source[position] !== ')') return null;
  return { label: source.slice(open + 1, close), href: safeHref(destination), end: position + 1 };
}

function bareUrl(source: string): string | null {
  const match = BARE_URL.exec(source);
  if (!match) return null;
  let url = match[0];
  for (;;) {
    const last = url.at(-1);
    if (last && '.,:;!?"\'*_~'.includes(last)) {
      url = url.slice(0, -1);
    } else if (last === ')' && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) {
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  return url.length > 'https://'.length ? url : null;
}

function containsLink(nodes: readonly Inline[]): boolean {
  return nodes.some((node) => node.type === 'link' || ('children' in node && containsLink(node.children)));
}

function plainText(nodes: readonly Inline[]): string {
  return nodes.map((node) => {
    if (node.type === 'text' || node.type === 'code') return node.text;
    if (node.type === 'break') return ' ';
    return plainText(node.children);
  }).join('');
}

function mergeText(nodes: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const node of nodes) {
    const previous = merged.at(-1);
    if (node.type === 'text' && previous?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', text: previous.text + node.text };
    } else {
      merged.push(node);
    }
  }
  return merged;
}
