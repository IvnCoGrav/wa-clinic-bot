import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { resolveCustomPersonaPath, BOT_PERSONA_PROMPT } from '../../src/config/persona';

describe('CFG-02: Custom Persona Path Resolution', () => {
  it('should resolve persona_custom.txt path properly', () => {
    const resolved = resolveCustomPersonaPath();
    expect(typeof resolved).toBe('string');
    expect(resolved.endsWith('persona_custom.txt')).toBe(true);
    // If the file exists in src/config, it must resolve to an existing file
    const srcPath = path.join(process.cwd(), 'src', 'config', 'persona_custom.txt');
    if (fs.existsSync(srcPath)) {
      expect(fs.existsSync(resolved)).toBe(true);
    }
  });

  it('should export non-empty BOT_PERSONA_PROMPT', () => {
    expect(BOT_PERSONA_PROMPT).toBeDefined();
    expect(BOT_PERSONA_PROMPT.length).toBeGreaterThan(100);
  });
});
