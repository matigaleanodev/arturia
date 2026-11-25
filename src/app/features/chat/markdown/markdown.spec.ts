import { describe, expect, it } from 'vitest';

import { type Block, type Inline, parseInline, parseMarkdown, safeHref } from './markdown';

const text = (value: string): Inline => ({ type: 'text', text: value });
const paragraph = (...children: Inline[]): Block => ({ type: 'paragraph', children });

describe('parseMarkdown blocks', () => {
  it('parses headings, paragraphs and keeps single line breaks', () => {
    expect(parseMarkdown('# Título\n\nUna línea\notra línea\n\n### Sub ###')).toEqual([
      { type: 'heading', level: 1, children: [text('Título')] },
      paragraph(text('Una línea'), { type: 'break' }, text('otra línea')),
      { type: 'heading', level: 3, children: [text('Sub')] },
    ]);
    expect(parseMarkdown('## C# y F#\n\n# ###\n\n```js extra\nx\n```\n\n``` a`b')).toEqual([
      { type: 'heading', level: 2, children: [text('C# y F#')] },
      { type: 'heading', level: 1, children: [] },
      { type: 'code', lang: 'js', text: 'x' },
      paragraph(text('``` a`b')),
    ]);
  });

  it('parses unordered, ordered and nested lists', () => {
    expect(parseMarkdown('- uno\n- dos\n  - dos.a\n\n3. tres\n4. cuatro')).toEqual([
      {
        type: 'list', ordered: false, start: 1, items: [
          [paragraph(text('uno'))],
          [paragraph(text('dos')), { type: 'list', ordered: false, start: 1, items: [[paragraph(text('dos.a'))]] }],
        ],
      },
      { type: 'list', ordered: true, start: 3, items: [[paragraph(text('tres'))], [paragraph(text('cuatro'))]] },
    ]);
  });

  it('parses fenced code without interpreting its content, and leaves an unclosed fence open while streaming', () => {
    expect(parseMarkdown('```ts\nconst a = **b**;\n<script>x</script>\n```\nfin')).toEqual([
      { type: 'code', lang: 'ts', text: 'const a = **b**;\n<script>x</script>' },
      paragraph(text('fin')),
    ]);
    expect(parseMarkdown('Antes\n\n```\nlínea parcial')).toEqual([
      paragraph(text('Antes')),
      { type: 'code', lang: '', text: 'línea parcial' },
    ]);
  });

  it('parses pipe tables with alignment and inline content', () => {
    expect(parseMarkdown('| A | **B** | C |\n|:--|:-:|--:|\n| 1 | `2` | 3 |\n| 4 \\| 5 | | 6 |')).toEqual([{
      type: 'table',
      align: ['left', 'center', 'right'],
      head: [[text('A')], [{ type: 'strong', children: [text('B')] }], [text('C')]],
      rows: [
        [[text('1')], [{ type: 'code', text: '2' }], [text('3')]],
        [[text('4 | 5')], [], [text('6')]],
      ],
    }]);
  });

  it('pads and trims table rows to the header width', () => {
    const [table] = parseMarkdown('a | b\n--- | ---\n1\n1 | 2 | 3');
    expect(table).toMatchObject({ type: 'table', rows: [[[text('1')], []], [[text('1')], [text('2')]]] });
  });

  it('parses quotes and rules', () => {
    expect(parseMarkdown('> cita\n> sigue\n\n---\n\n***')).toEqual([
      { type: 'quote', children: [paragraph(text('cita'), { type: 'break' }, text('sigue'))] },
      { type: 'rule' },
      { type: 'rule' },
    ]);
  });

  it('keeps raw HTML as literal text', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)>\n<b>hola</b>')).toEqual([
      paragraph(text('<img src=x onerror=alert(1)>'), { type: 'break' }, text('<b>hola</b>')),
    ]);
  });

  it('bounds nesting depth', () => {
    const deep = parseMarkdown('>'.repeat(200) + ' fondo');
    let depth = 0;
    let block: Block | undefined = deep[0];
    while (block?.type === 'quote') {
      depth++;
      block = block.children[0];
    }
    expect(depth).toBeLessThanOrEqual(8);
    expect(JSON.stringify(deep)).toContain('fondo');
  });
});

describe('parseInline', () => {
  it('parses strong, emphasis, strikethrough and code spans', () => {
    expect(parseInline('**negrita** y *cursiva*, __otra__ _más_ ~~no~~ `a*b*`')).toEqual([
      { type: 'strong', children: [text('negrita')] },
      text(' y '),
      { type: 'em', children: [text('cursiva')] },
      text(', '),
      { type: 'strong', children: [text('otra')] },
      text(' '),
      { type: 'em', children: [text('más')] },
      text(' '),
      { type: 'del', children: [text('no')] },
      text(' '),
      { type: 'code', text: 'a*b*' },
    ]);
  });

  it('nests emphasis and ignores intraword underscores', () => {
    expect(parseInline('***ambas*** y snake_case_name')).toEqual([
      { type: 'strong', children: [{ type: 'em', children: [text('ambas')] }] },
      text(' y snake_case_name'),
    ]);
    expect(parseInline('**a *b* c**')).toEqual([
      { type: 'strong', children: [text('a '), { type: 'em', children: [text('b')] }, text(' c')] },
    ]);
  });

  it('keeps unmatched delimiters while a reply is still streaming', () => {
    expect(parseInline('texto **sin cerrar')).toEqual([text('texto **sin cerrar')]);
    expect(parseInline('`código abierto')).toEqual([text('`código abierto')]);
    expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
  });

  it('honors backslash escapes', () => {
    expect(parseInline('\\*literal\\* \\[no\\](link)')).toEqual([text('*literal* [no](link)')]);
  });

  it('parses safe links, autolinks and bare URLs', () => {
    expect(parseInline('[docs](https://example.com/a_(b)) <mailto:a@b.co> y https://example.com/x.')).toEqual([
      { type: 'link', href: 'https://example.com/a_(b)', children: [text('docs')] },
      text(' '),
      { type: 'link', href: 'mailto:a@b.co', children: [text('mailto:a@b.co')] },
      text(' y '),
      { type: 'link', href: 'https://example.com/x', children: [text('https://example.com/x')] },
      text('.'),
    ]);
    expect(parseInline('ver:https://example.com y [https://a.example](https://a.example)')).toEqual([
      text('ver:https://example.com y '),
      { type: 'link', href: 'https://a.example/', children: [text('https://a.example')] },
    ]);
  });

  it('renders the label without a link for dangerous or relative URLs', () => {
    for (const url of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox', 'file:///etc/passwd', '/relativa', '//host/x',
    ]) {
      expect(JSON.stringify(parseInline(`[clic](${url})`)), url).not.toContain('"link"');
    }
    expect(parseInline('[clic](javascript:alert(1))')).toEqual([text('clic')]);
    expect(parseInline('[clic](/relativa)')).toEqual([text('clic')]);
    expect(parseInline('<javascript:alert(1)>')).toEqual([text('<javascript:alert(1)>')]);
  });

  it('does not nest links and shows image alternatives as text', () => {
    expect(parseInline('[a [b](https://b.example)](https://a.example)')).toEqual([
      text('[a '),
      { type: 'link', href: 'https://b.example/', children: [text('b')] },
      text(']('),
      { type: 'link', href: 'https://a.example/', children: [text('https://a.example')] },
      text(')'),
    ]);
    expect(parseInline('![logo](https://example.com/l.png)')).toEqual([text('logo')]);
  });

  it('stays linear on pathological input', () => {
    const started = performance.now();
    parseInline('*a '.repeat(20_000) + '['.repeat(20_000) + '`'.repeat(5_000) + ' **x'.repeat(20_000));
    parseMarkdown('- '.repeat(5_000) + '\n' + '> '.repeat(5_000));
    parseMarkdown('# a' + ' '.repeat(50_000) + 'x');
    parseMarkdown('```' + 'a'.repeat(50_000) + '`');
    parseInline('![a]('.repeat(20_000));
    expect(performance.now() - started).toBeLessThan(1_500);
  });
});

describe('safeHref', () => {
  it('accepts only absolute http, https and mailto URLs', () => {
    expect(safeHref('https://example.com/a b')).toBeNull();
    expect(safeHref('http://example.com')).toBe('http://example.com/');
    expect(safeHref('mailto:yo@example.com')).toBe('mailto:yo@example.com');
    expect(safeHref('https://user:pass@example.com')).toBeNull();
    expect(safeHref('ftp://example.com')).toBeNull();
    expect(safeHref('')).toBeNull();
  });
});
