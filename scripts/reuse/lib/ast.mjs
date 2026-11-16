import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT_DIR, toAbsolute, toRelative, listFiles } from './paths.mjs';

/**
 * Mendaftar semua file TS/TSX dalam root target dengan pengecualian tertentu.
 * @param {string} [rootDir='src']
 * @param {{ exclude?: string[] }} [options]
 * @returns {string[]} path relatif terhadap ROOT_DIR
 */
export function listTsFiles(rootDir = 'src', { exclude = ['src/scripts', 'src/cli'] } = {}) {
  return listFiles(rootDir, {
    extensions: ['.ts', '.tsx'],
    exclude
  });
}

/**
 * Mem-parse file TypeScript menjadi AST ts.SourceFile.
 * @param {string} filePathRelOrAbs
 * @returns {ts.SourceFile}
 */
export function parseTsFile(filePathRelOrAbs) {
  const fullPath = toAbsolute(filePathRelOrAbs);
  const sourceText = fs.readFileSync(fullPath, 'utf8');
  return ts.createSourceFile(fullPath, sourceText, ts.ScriptTarget.Latest, true);
}

/**
 * Mengumpulkan semua deklarasi fungsi / method / arrow function dalam file.
 * @param {ts.SourceFile} sourceFile
 * @param {string} [filePath]
 * @returns {Array<{ name: string, startLine: number, endLine: number, tokenCount: number, bodyText: string, node: ts.Node }>}
 */
export function collectFunctionLike(sourceFile, filePath = '') {
  const functions = [];

  function processBody(name, node, bodyNode) {
    if (!bodyNode) return;
    const bodyText = bodyNode.getText(sourceFile);

    // Hitung token menggunakan scanner TS (trivia / komentar diabaikan otomatis)
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, bodyText);
    let token = scanner.scan();
    let tokenCount = 0;
    while (token !== ts.SyntaxKind.EndOfFileToken) {
      tokenCount++;
      token = scanner.scan();
    }

    const { line: startLine0 } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const { line: endLine0 } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

    functions.push({
      name: name || '<anonymous>',
      filePath: filePath ? toRelative(filePath) : toRelative(sourceFile.fileName),
      startLine: startLine0 + 1,
      endLine: endLine0 + 1,
      tokenCount,
      bodyText,
      node
    });
  }

  function visit(node) {
    // 1. Function declaration: function foo() {}
    if (ts.isFunctionDeclaration(node) && node.body) {
      processBody(node.name?.text || '<anonymous>', node, node.body);
    }
    // 2. Method declaration: method() {}
    else if (ts.isMethodDeclaration(node) && node.body) {
      const methodName = node.name?.getText(sourceFile) || '<method>';
      processBody(methodName, node, node.body);
    }
    // 3. Arrow function / Function expression yang di-assign ke variabel
    else if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        const varName = node.name.getText(sourceFile);
        processBody(varName, node, node.initializer.body);
      }
    }

    ts.forEachChild(node, visit);
  }

  ts.forEachChild(sourceFile, visit);
  return functions;
}

/**
 * Mengumpulkan deklarasi top-level pada sebuah file TypeScript.
 * @param {ts.SourceFile} sourceFile
 * @returns {Array<{ name: string, kind: string, startLine: number, isExported: boolean }>}
 */
export function collectTopLevelDeclarations(sourceFile) {
  const declarations = [];

  for (const node of sourceFile.statements) {
    const { line: startLine0 } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const startLine = startLine0 + 1;

    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = modifiers ? modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword) : false;

    if (ts.isFunctionDeclaration(node) && node.name) {
      declarations.push({
        name: node.name.text,
        kind: 'function',
        startLine,
        isExported
      });
    } else if (ts.isClassDeclaration(node) && node.name) {
      declarations.push({
        name: node.name.text,
        kind: 'class',
        startLine,
        isExported
      });
    } else if (ts.isEnumDeclaration(node) && node.name) {
      declarations.push({
        name: node.name.text,
        kind: 'enum',
        startLine,
        isExported
      });
    } else if (ts.isInterfaceDeclaration(node) && node.name) {
      declarations.push({
        name: node.name.text,
        kind: 'interface',
        startLine,
        isExported
      });
    } else if (ts.isTypeAliasDeclaration(node) && node.name) {
      declarations.push({
        name: node.name.text,
        kind: 'type',
        startLine,
        isExported
      });
    } else if (ts.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        if (decl.name && ts.isIdentifier(decl.name)) {
          declarations.push({
            name: decl.name.text,
            kind: 'variable',
            startLine,
            isExported
          });
        }
      }
    }
  }

  return declarations;
}

/**
 * Mengumpulkan seluruh simbol yang diekspor dari sebuah file TypeScript.
 * @param {ts.SourceFile} sourceFile
 * @returns {Array<{ name: string, kind: string, startLine: number, isReexport: boolean, moduleSpecifier?: string }>}
 */
export function collectExports(sourceFile) {
  const exports = [];

  for (const node of sourceFile.statements) {
    const { line: startLine0 } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const startLine = startLine0 + 1;

    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const isExported = modifiers ? modifiers.some(m => m.kind === ts.SyntaxKind.ExportKeyword) : false;

    if (isExported) {
      if (ts.isFunctionDeclaration(node) && node.name) {
        exports.push({ name: node.name.text, kind: 'function', startLine, isReexport: false });
      } else if (ts.isClassDeclaration(node) && node.name) {
        exports.push({ name: node.name.text, kind: 'class', startLine, isReexport: false });
      } else if (ts.isEnumDeclaration(node) && node.name) {
        exports.push({ name: node.name.text, kind: 'enum', startLine, isReexport: false });
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        exports.push({ name: node.name.text, kind: 'interface', startLine, isReexport: false });
      } else if (ts.isTypeAliasDeclaration(node) && node.name) {
        exports.push({ name: node.name.text, kind: 'type', startLine, isReexport: false });
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (decl.name && ts.isIdentifier(decl.name)) {
            exports.push({ name: decl.name.text, kind: 'variable', startLine, isReexport: false });
          }
        }
      }
    }

    // Export declaration: export { x, y as z } [from './mod']
    if (ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : undefined;

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          exports.push({
            name: el.name.text,
            kind: 'reexport',
            startLine,
            isReexport: Boolean(moduleSpecifier),
            moduleSpecifier
          });
        }
      }
    }

    // Export assignment: export default ...
    if (ts.isExportAssignment(node)) {
      exports.push({
        name: 'default',
        kind: 'default',
        startLine,
        isReexport: false
      });
    }
  }

  return exports;
}
