import { describe, it, expect, vi } from 'vitest';
import { parseSseFrames, streamCopilotTurn } from '../../packages/admin-dashboard/src/services/copilotStreamClient';

describe('copilotStreamClient (murni, offline)', () => {
  it('parseSseFrames: memproses frame terpotong menjadi event hanya setelah terminator \\n\\n', () => {
    // Potongan 1 belum lengkap
    const chunk1 = 'event: stage\ndata: {"label":"Mencari"}';
    const res1 = parseSseFrames(chunk1);
    expect(res1.events).toHaveLength(0);
    expect(res1.rest).toBe(chunk1);

    // Potongan 2 melengkapi terminator \n\n
    const chunk2 = res1.rest + '\n\n';
    const res2 = parseSseFrames(chunk2);
    expect(res2.events).toHaveLength(1);
    expect(res2.events[0]).toEqual({
      event: 'stage',
      data: '{"label":"Mencari"}',
    });
    expect(res2.rest).toBe('');
  });

  it('parseSseFrames: mengabaikan frame komentar / keepalive SSE yang diawali titik dua :', () => {
    const sse = ': keepalive heartbeat\n\nevent: chunk\ndata: {"text":"Halo"}\n\n: another comment\n\n';
    const res = parseSseFrames(sse);
    expect(res.events).toHaveLength(1);
    expect(res.events[0]).toEqual({
      event: 'chunk',
      data: '{"text":"Halo"}',
    });
  });

  it('streamCopilotTurn: mengabaikan data bukan JSON dan menghitung akumulasi rowsTotal dari event tool_result', async () => {
    const ssePayload = [
      ': ping\n\n',
      'event: stage\ndata: invalid-json-ignore-me\n\n',
      'event: stage\ndata: {"label":"Menganalisis","step":1,"maxSteps":3}\n\n',
      'event: tool_start\ndata: {"tool":"query_reservations_by_filter"}\n\n',
      'event: tool_result\ndata: {"tool":"query_reservations_by_filter","count":5}\n\n',
      'event: tool_start\ndata: {"tool":"query_unreplied_chats"}\n\n',
      'event: tool_result\ndata: {"tool":"query_unreplied_chats","count":3}\n\n',
      'event: chunk\ndata: {"text":"Ditemukan 8 data pasien."}\n\n',
      'event: done\ndata: {"answer":"Ditemukan 8 data pasien.","grounded":true}\n\n',
    ].join('');

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload));
        controller.close();
      },
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    });

    const stages: string[] = [];
    const tools: string[] = [];

    const result = await streamCopilotTurn({
      message: 'Cek pasien hari ini',
      history: [],
      fetchFn: mockFetch as any,
      handlers: {
        onStage: (p) => {
          if (p.label) stages.push(p.label);
        },
        onToolStart: (p) => {
          if (p.tool) tools.push(p.tool);
        },
      },
    });

    expect(stages).toEqual(['Menganalisis']);
    expect(tools).toEqual(['query_reservations_by_filter', 'query_unreplied_chats']);
    expect(result.rowsTotal).toBe(8); // 5 + 3
    expect(result.answer).toBe('Ditemukan 8 data pasien.');
    expect(result.grounded).toBe(true);
    expect(result.toolsUsed).toEqual(['query_reservations_by_filter', 'query_unreplied_chats']);
  });

  it('streamCopilotTurn: pembatalan via AbortSignal melempar AbortError', async () => {
    const abortController = new AbortController();

    const mockFetch = vi.fn().mockImplementation((_, opts) => {
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('The user aborted a request.');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = streamCopilotTurn({
      message: 'Halo',
      history: [],
      signal: abortController.signal,
      fetchFn: mockFetch as any,
    });

    abortController.abort();
    await expect(promise).rejects.toThrow('Pencarian dibatalkan oleh pengguna.');
  });
});
