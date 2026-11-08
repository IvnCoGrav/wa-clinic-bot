import { describe, it, expect } from 'vitest';
import { resolveCopilotBadge } from '../../packages/admin-dashboard/src/utils/copilotStatus';

describe('resolveCopilotBadge — matriks badge Copilot deterministik', () => {
  it('idle -> kind: none', () => {
    expect(resolveCopilotBadge({ status: 'idle', hasUnread: false, panelOpen: false }).kind).toBe('none');
    expect(resolveCopilotBadge({ status: 'idle', hasUnread: true, panelOpen: true }).kind).toBe('none');
  });

  it('running -> kind: spinner', () => {
    expect(resolveCopilotBadge({ status: 'running', hasUnread: false, panelOpen: false }).kind).toBe('spinner');
    expect(resolveCopilotBadge({ status: 'running', hasUnread: true, panelOpen: true }).kind).toBe('spinner');
  });

  it('done + hasUnread + !panelOpen -> kind: dot', () => {
    const badge = resolveCopilotBadge({ status: 'done', hasUnread: true, panelOpen: false });
    expect(badge.kind).toBe('dot');
    expect(badge.label).toBe('Jawaban Copilot baru tersedia');
  });

  it('done + hasUnread + panelOpen (sudah dibaca) -> kind: none', () => {
    const badge = resolveCopilotBadge({ status: 'done', hasUnread: true, panelOpen: true });
    expect(badge.kind).toBe('none');
  });

  it('done + !hasUnread -> kind: none', () => {
    expect(resolveCopilotBadge({ status: 'done', hasUnread: false, panelOpen: false }).kind).toBe('none');
    expect(resolveCopilotBadge({ status: 'done', hasUnread: false, panelOpen: true }).kind).toBe('none');
  });

  it('error -> kind: warn', () => {
    const badge = resolveCopilotBadge({ status: 'error', hasUnread: false, panelOpen: false });
    expect(badge.kind).toBe('warn');
    expect(badge.label).toBe('Copilot mengalami kendala');
  });
});
