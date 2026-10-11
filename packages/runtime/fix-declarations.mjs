import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const dist = fileURLToPath(new URL('./dist/', import.meta.url));
// tsc preserves source module specifiers. Make declaration references valid in NodeNext
// as well as bundlers, without changing the source imports used by the local tools.
for (const name of readdirSync(dist, { recursive: true }).filter(name => name.endsWith('.d.ts'))) {
  const file = resolve(dist, name), text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(node) {
    if (ts.isStringLiteral(node) && node.text.startsWith('.') && (
      ((ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent)) && node.parent.moduleSpecifier === node)
      || (ts.isLiteralTypeNode(node.parent) && ts.isImportTypeNode(node.parent.parent))
    )) {
      const base = resolve(dirname(file), node.text.replace(/\.(?:js|ts)$/, ''));
      const target = [`${base}.d.ts`, resolve(base, 'index.d.ts')].find(existsSync);
      if (!target) throw new Error(`Unresolved declaration import in ${name}: ${node.text}`);
      const path = relative(dirname(file), target).split(sep).join('/').replace(/\.d\.ts$/, '.js');
      edits.push({ start: node.getStart(source) + 1, end: node.end - 1, path: path.startsWith('.') ? path : `./${path}` });
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.path + result.slice(edit.end);
  writeFileSync(file, result);
}
