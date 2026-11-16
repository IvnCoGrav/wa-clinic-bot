import crypto from 'node:crypto';
import ts from 'typescript';

/**
 * Menghitung exact hash dan structural hash dari body teks fungsi.
 * @param {string} bodyText
 * @param {{ minTokens?: number }} [options]
 * @returns {{ tokenCount: number, exactHash: string | null, structuralHash: string | null }}
 */
export function computeFingerprint(bodyText, { minTokens = 40 } = {}) {
  if (!bodyText || typeof bodyText !== 'string') {
    return { tokenCount: 0, exactHash: null, structuralHash: null };
  }

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, bodyText);
  let token = scanner.scan();

  const exactTokens = [];
  const structuralTokens = [];
  let tokenCount = 0;

  while (token !== ts.SyntaxKind.EndOfFileToken) {
    tokenCount++;
    const text = scanner.getTokenText();

    // 1. Exact tokens: syntax kind + literal token text (identifier dan literal dipertahankan)
    exactTokens.push(`${token}:${text}`);

    // 2. Structural tokens: identifier diganti ID, string/numeric diganti LIT
    if (token === ts.SyntaxKind.Identifier) {
      structuralTokens.push('ID');
    } else if (token === ts.SyntaxKind.StringLiteral || token === ts.SyntaxKind.NumericLiteral || token === ts.SyntaxKind.NoSubstitutionTemplateLiteral) {
      structuralTokens.push('LIT');
    } else {
      structuralTokens.push(String(token));
    }

    token = scanner.scan();
  }

  // Jika di bawah ambang batas token, tidak dihitung sebagai duplikasi
  if (tokenCount < minTokens) {
    return { tokenCount, exactHash: null, structuralHash: null };
  }

  const exactString = exactTokens.join(',');
  const structuralString = structuralTokens.join(',');

  const exactHash = 'sha256:' + crypto.createHash('sha256').update(exactString).digest('hex').slice(0, 16);
  const structuralHash = 'sha256:' + crypto.createHash('sha256').update(structuralString).digest('hex').slice(0, 16);

  return {
    tokenCount,
    exactHash,
    structuralHash
  };
}
