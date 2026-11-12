import { unzipSync } from 'fflate';
import { Parser } from 'htmlparser2';

export function htmlText(bytes: Uint8Array): string {
  const output: string[] = [];
  let ignored = 0;
  const hidden = new Set(['script', 'style', 'noscript', 'template', 'svg']);
  const block = new Set([
    'p',
    'div',
    'section',
    'article',
    'main',
    'li',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'br',
    'tr',
    'pre',
  ]);
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (
          hidden.has(name) ||
          ignored > 0 ||
          'hidden' in attributes ||
          attributes['aria-hidden'] === 'true'
        )
          ignored++;
        if (!ignored && block.has(name)) output.push('\n');
      },
      ontext(text) {
        if (!ignored) output.push(text);
      },
      onclosetag(name) {
        if (ignored) ignored--;
        else if (block.has(name)) output.push('\n');
      },
    },
    { decodeEntities: true },
  );
  parser.end(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  return output
    .join('')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function docxText(bytes: Uint8Array, maximumXmlBytes: number): string {
  let entries = 0;
  const files = unzipSync(bytes, {
    filter(file) {
      entries++;
      if (entries > 1000) throw new Error('DOCX archive exceeds the entry limit.');
      if (file.name !== 'word/document.xml') return false;
      if (file.originalSize > maximumXmlBytes)
        throw new Error('DOCX document XML exceeds the expanded byte limit.');
      return true;
    },
  });
  const document = files['word/document.xml'];
  if (!document || document.length > maximumXmlBytes)
    throw new Error('DOCX has no bounded main document XML.');
  const xml = new TextDecoder('utf-8', { fatal: true }).decode(document);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('DOCX DTD/entity declarations are unsupported.');
  const output: string[] = [];
  let textDepth = 0;
  const word = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const namespaces: Record<string, string>[] = [{}];
  const tags: { name: string; local: string; word: boolean }[] = [];
  let rootSeen = false;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (tags.length >= 256) throw new Error('DOCX XML nesting exceeds the depth limit.');
        const scope = { ...namespaces.at(-1) };
        for (const [key, value] of Object.entries(attributes)) {
          if (key === 'xmlns') scope[''] = value;
          else if (key.startsWith('xmlns:')) scope[key.slice(6)] = value;
        }
        namespaces.push(scope);
        const pieces = name.split(':');
        const prefix = pieces.length === 2 ? pieces[0]! : '';
        const local = pieces.at(-1)!;
        const isWord = scope[prefix] === word;
        if (tags.length === 0) {
          if (!isWord || local !== 'document')
            throw new Error('DOCX has an unsupported document namespace.');
          rootSeen = true;
        }
        tags.push({ name, local, word: isWord });
        if (!isWord) return;
        if (local === 't') textDepth++;
        if (['br', 'cr', 'tab'].includes(local)) output.push(local === 'tab' ? '\t' : '\n');
      },
      ontext(text) {
        if (textDepth) output.push(text);
      },
      onclosetag(name, implied) {
        const tag = tags.pop();
        namespaces.pop();
        if (
          !tag ||
          tag.name !== name ||
          (implied && !xml.slice(parser.startIndex, parser.endIndex + 1).endsWith('/>'))
        )
          throw new Error('DOCX document XML is malformed.');
        if (tag.word && tag.local === 't') textDepth--;
        if (tag.word && ['p', 'tr'].includes(tag.local)) output.push('\n');
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.end(xml);
  if (!rootSeen || tags.length) throw new Error('DOCX has no complete main document.');
  return output.join('').trim();
}
