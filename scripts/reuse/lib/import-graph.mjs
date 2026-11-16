import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT_DIR, toAbsolute, toRelative, exists } from './paths.mjs';

/**
 * Menyelesaikan path import relatif / internal ke path file di disk.
 * @param {string} fromFileRelOrAbs
 * @param {string} specifier
 * @returns {string | null} path relatif terhadap ROOT_DIR (format slash /)
 */
export function resolveImportPath(fromFileRelOrAbs, specifier) {
  if (!specifier || typeof specifier !== 'string') return null;

  // Hanya proses import internal (relatif ./, ../ atau src/)
  if (!specifier.startsWith('.') && !specifier.startsWith('src/') && !specifier.startsWith('src\\')) {
    return null;
  }

  const fromAbs = toAbsolute(fromFileRelOrAbs);
  const dir = path.dirname(fromAbs);

  let basePath;
  if (specifier.startsWith('src/') || specifier.startsWith('src\\')) {
    basePath = path.resolve(ROOT_DIR, specifier);
  } else {
    basePath = path.resolve(dir, specifier);
  }

  const candidates = [
    basePath + '.ts',
    basePath + '.tsx',
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    basePath + '.mjs',
    basePath + '.js',
    basePath
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) {
      return toRelative(c);
    }
  }

  return null;
}

/**
 * Mengekstrak seluruh import statis dan dinamis dari sebuah SourceFile.
 * @param {ts.SourceFile} sourceFile
 * @param {string} filePath
 * @returns {Array<{ specifier: string, resolved: string | null, line: number, isDynamic: boolean }>}
 */
export function extractImports(sourceFile, filePath) {
  const imports = [];

  function visit(node) {
    const { line: startLine0 } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const line = startLine0 + 1;

    // 1. Static import: import { a } from 'specifier'
    if (ts.isImportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        imports.push({
          specifier,
          resolved: resolveImportPath(filePath, specifier),
          line,
          isDynamic: false
        });
      }
    }
    // 2. Static re-export: export { a } from 'specifier'
    else if (ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        imports.push({
          specifier,
          resolved: resolveImportPath(filePath, specifier),
          line,
          isDynamic: false
        });
      }
    }
    // 3. Dynamic import: import('specifier')
    else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          const specifier = arg.text;
          imports.push({
            specifier,
            resolved: resolveImportPath(filePath, specifier),
            line,
            isDynamic: true
          });
        }
      }
      // 4. CommonJS require: require('specifier')
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          const specifier = arg.text;
          imports.push({
            specifier,
            resolved: resolveImportPath(filePath, specifier),
            line,
            isDynamic: true
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return imports;
}

/**
 * Membangun dependency graph untuk sekumpulan file TS.
 * @param {string[]} fileList daftar file relatif
 * @returns {{ graph: Map<string, string[]>, fileImports: Map<string, Array<{ specifier: string, resolved: string | null, line: number, isDynamic: boolean }>> }}
 */
export function buildImportGraph(fileList) {
  const graph = new Map();
  const fileImports = new Map();

  for (const f of fileList) {
    const full = toAbsolute(f);
    if (!fs.existsSync(full)) continue;

    try {
      const sourceText = fs.readFileSync(full, 'utf8');
      const sf = ts.createSourceFile(full, sourceText, ts.ScriptTarget.Latest, true);
      const imps = extractImports(sf, f);

      fileImports.set(f, imps);

      const resolvedTargets = imps
        .map(i => i.resolved)
        .filter(r => r !== null && r !== f);

      graph.set(f, Array.from(new Set(resolvedTargets)));
    } catch {
      graph.set(f, []);
      fileImports.set(f, []);
    }
  }

  return { graph, fileImports };
}

/**
 * Mencari siklus ketergantungan (circular dependencies) menggunakan algoritma Tarjan SCC.
 * @param {Map<string, string[]>} graph
 * @returns {string[][]} daftar siklus terurut
 */
export function findCircularDependencyCycles(graph) {
  let index = 0;
  const stack = [];
  const indices = new Map();
  const lowlinks = new Map();
  const onStack = new Set();
  const sccs = [];

  function strongConnect(v) {
    indices.set(v, index);
    lowlinks.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    const neighbors = graph.get(v) || [];
    for (const w of neighbors) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlinks.set(v, Math.min(lowlinks.get(v), lowlinks.get(w)));
      } else if (onStack.has(w)) {
        lowlinks.set(v, Math.min(lowlinks.get(v), indices.get(w)));
      }
    }

    if (lowlinks.get(v) === indices.get(v)) {
      const scc = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);

      if (scc.length > 1) {
        sccs.push(scc.reverse());
      }
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  // Normalisasi siklus agar formatnya konsisten untuk perbandingan baseline
  return sccs.map(cycle => {
    // Putar cycle sehingga elemen terkecil berada di depan
    const minElem = [...cycle].sort()[0];
    const minIdx = cycle.indexOf(minElem);
    return cycle.slice(minIdx).concat(cycle.slice(0, minIdx));
  });
}
