import { describe, it, expect } from 'vitest';
import { escapeScriptText, jsStringLiteral, safeJsonForScript } from '../../src/utils/script-escape';

describe('script-escape seam', () => {
  it('menetralkan penutup blok script', () => {
    const payload = '</script><img src=x onerror=alert(1)>';
    const lit = jsStringLiteral(payload);
    expect(lit).not.toContain('</script');
    expect(lit).not.toContain('<img');
    expect(lit).toContain('\\u003c');
  });

  it('string literal tetap JSON-valid dan nilainya utuh', () => {
    const payload = `';alert(1)// </script> & "kutip" \u2028 \u2029`;
    const lit = jsStringLiteral(payload);
    expect(JSON.parse(lit)).toBe(payload);
    expect(lit).not.toContain('</script');
    expect(lit).not.toContain('\u2028');
    expect(lit).not.toContain('\u2029');
  });

  it('JSON objek aman disisipkan dan tetap bisa diparse', () => {
    const value = {
      phone: '628123',
      note: '</script><script>alert(1)</script>',
      nested: { evil: '&<>' },
    };
    const out = safeJsonForScript(value);
    expect(out).not.toContain('</script');
    expect(out).not.toContain('<script');
    expect(JSON.parse(out)).toEqual(value);
  });

  it('escapeScriptText hanya menyentuh karakter pemutus konteks', () => {
    expect(escapeScriptText('abc')).toBe('abc');
    expect(escapeScriptText('a<b>c&d')).toBe('a\\u003cb\\u003ec\\u0026d');
  });
});
