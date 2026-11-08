import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../../db/client';
import { DEFAULT_TENANT_ID } from '../../../config/tenant';
import { auditService } from '../../../services/audit.service';
import { AI_ELIGIBILITY_ESCALATION_REASON } from '../../../services/ai-eligibility.service';
import { buildProvidersStatus, inMemoryConversationBehavior, resolveTenantId } from './shared';

export async function registerAiConfigRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * GET /api/admin/persona
   */
  fastify.get('/api/admin/persona', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(request);
    const { loadPersonaFromDb, getMaxCharsPerReply } = await import('../../../config/persona');
    const persona = await loadPersonaFromDb(tenantId);
    return reply.status(200).send({ success: true, persona, maxCharsPerReply: getMaxCharsPerReply(tenantId) });
  });

  /**
   * POST /api/admin/persona
   */
  fastify.post(
    '/api/admin/persona',
    async (
      request: FastifyRequest<{
        Body: { persona: string; maxCharsPerReply?: number | null | '' };
      }>,
      reply: FastifyReply
    ) => {
      const { persona, maxCharsPerReply } = request.body || {};
      if (!persona || !persona.trim()) {
        return reply.status(400).send({ error: 'System persona prompt is required' });
      }

      const tenantId = resolveTenantId(request);
      try {
        const { savePersonaToDb, getMaxCharsPerReply } = await import('../../../config/persona');
        let maxChars: number | null | undefined;
        if (maxCharsPerReply === undefined) {
          maxChars = undefined;
        } else if (maxCharsPerReply === '' || maxCharsPerReply === null) {
          maxChars = null;
        } else {
          maxChars = Math.max(0, Number(maxCharsPerReply));
        }
        await savePersonaToDb(persona, tenantId, maxChars);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'BOT_PERSONA_CHANGE',
          targetId: tenantId,
          payload: {
            details: `System persona prompt updated to: ${persona.substring(0, 100)}...${
              maxChars === undefined ? '' : ` | max_chars_per_reply=${maxChars}`
            }`,
            tenantId,
          },
        });

        const savedMaxChars = maxChars === undefined ? getMaxCharsPerReply(tenantId) : maxChars;
        return reply.status(200).send({
          success: true,
          message: 'System persona prompt berhasil diperbarui secara live!',
          persona,
          maxCharsPerReply: savedMaxChars,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: `Gagal memperbarui persona: ${err.message}` });
      }
    }
  );

  /**
   * GET /api/admin/persona/prompt-config
   * Mengambil konfigurasi 4-section prompt aktif atau default
   */
  fastify.get('/api/admin/persona/prompt-config', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { TenantPromptConfigService } = await import('../../../services/tenant-prompt-config.service');
      const resolved = await TenantPromptConfigService.getPromptConfigMeta(tenantId);
      const defaultConfig = TenantPromptConfigService.getDefaultConfig();
      const config = resolved.config || defaultConfig;
      const isCustom = resolved.source === 'active';

      return reply.status(200).send({
        success: true,
        tenantId,
        isCustom,
        source: resolved.source,
        config,
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PUT /api/admin/persona/prompt-config
   * Menyimpan versi baru konfigurasi 4-section prompt
   */
  fastify.put(
    '/api/admin/persona/prompt-config',
    async (
      request: FastifyRequest<{
        Body: {
          personalityTone?: string;
          answeringHierarchy?: string;
          negativeConstraints?: string;
          medicalOverclaimRules?: string;
          changeSummary?: string;
        };
      }>,
      reply: FastifyReply
    ) => {
      try {
        const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
        const {
          personalityTone,
          answeringHierarchy,
          negativeConstraints,
          medicalOverclaimRules,
          changeSummary,
        } = request.body || {};

        if (!personalityTone?.trim()) {
          return reply.status(400).send({ success: false, error: 'personalityTone is required' });
        }
        if (!answeringHierarchy?.trim()) {
          return reply.status(400).send({ success: false, error: 'answeringHierarchy is required' });
        }
        if (!negativeConstraints?.trim()) {
          return reply.status(400).send({ success: false, error: 'negativeConstraints is required' });
        }
        if (!medicalOverclaimRules?.trim()) {
          return reply.status(400).send({ success: false, error: 'medicalOverclaimRules is required' });
        }

        const data = {
          personalityTone: personalityTone.trim(),
          answeringHierarchy: answeringHierarchy.trim(),
          negativeConstraints: negativeConstraints.trim(),
          medicalOverclaimRules: medicalOverclaimRules.trim(),
        };

        const author = (request as any).adminIdentity || (request as any).adminKeyUsed || 'admin';
        const summary = changeSummary?.trim() || 'Updated via Admin Dashboard';

        const { TenantPromptConfigService } = await import('../../../services/tenant-prompt-config.service');
        await TenantPromptConfigService.saveNewVersion(tenantId, data, author, summary);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'BOT_PROMPT_CONFIG_CHANGE',
          targetId: tenantId,
          payload: {
            summary,
            sections: {
              personalityToneLength: data.personalityTone.length,
              answeringHierarchyLength: data.answeringHierarchy.length,
              negativeConstraintsLength: data.negativeConstraints.length,
              medicalOverclaimRulesLength: data.medicalOverclaimRules.length,
            },
          },
        });

        return reply.status(200).send({
          success: true,
          message: 'Konfigurasi 4-seksi prompt berhasil disimpan!',
          tenantId,
          config: data,
        });
      } catch (err: any) {
        return reply.status(500).send({ success: false, error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/few-shots
   */
  fastify.get('/api/admin/few-shots', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    const { FewShotExemplarBank } = await import('../../../v3/agent/few-shot-exemplars');
    const exemplars = await FewShotExemplarBank.getAllExemplars(tenantId);
    return reply.status(200).send({
      success: true,
      data: exemplars,
    });
  });

  /**
   * POST /api/admin/few-shots
   */
  fastify.post(
    '/api/admin/few-shots',
    async (
      request: FastifyRequest<{
        Body: {
          scenario: string;
          customerMessage: string;
          idealResponse: string;
          tags?: string[];
          isActive?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { scenario, customerMessage, idealResponse, tags, isActive } = request.body || {};
      const cleanScenario = typeof scenario === 'string' ? scenario.trim() : '';
      const cleanCustomerMessage = typeof customerMessage === 'string' ? customerMessage.trim() : '';
      const cleanIdealResponse = typeof idealResponse === 'string' ? idealResponse.trim() : '';
      const cleanTags = Array.isArray(tags)
        ? tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim().toLowerCase()).filter(Boolean)
        : [];

      if (!cleanScenario || !cleanCustomerMessage || !cleanIdealResponse) {
        return reply.status(400).send({ error: 'Skenario, Pesan Pasien, dan Respon Ideal wajib diisi' });
      }

      if (cleanScenario.length > 150 || cleanCustomerMessage.length > 500 || cleanIdealResponse.length > 1000) {
        return reply.status(400).send({
          error: 'Panjang melebihi batas (skenario ≤150, pesan pasien ≤500, respon ideal ≤1000 karakter)',
        });
      }

      const { FewShotExemplarBank } = await import('../../../v3/agent/few-shot-exemplars');
      const created = await FewShotExemplarBank.createExemplar(
        {
          scenario: cleanScenario,
          customerMessage: cleanCustomerMessage,
          idealResponse: cleanIdealResponse,
          tags: cleanTags,
          isActive: isActive !== false,
        },
        tenantId
      );

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_CREATE',
        targetId: created.id,
        payload: { scenario, tags },
      });

      return reply.status(201).send({
        success: true,
        message: 'Contoh percakapan berhasil ditambahkan!',
        data: created,
      });
    }
  );

  /**
   * PUT /api/admin/few-shots/reorder — ubah urutan prioritas exemplar secara batch.
   */
  fastify.put(
    '/api/admin/few-shots/reorder',
    async (
      request: FastifyRequest<{
        Body: { orderedIds?: unknown };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { orderedIds } = request.body || {};
      if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string' || !id.trim())) {
        return reply.status(400).send({ error: 'orderedIds wajib berupa array berisi id string' });
      }

      const { FewShotExemplarBank } = await import('../../../v3/agent/few-shot-exemplars');
      const reordered = await FewShotExemplarBank.reorderExemplars(orderedIds as string[], tenantId);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_REORDER',
        targetId: 'ALL',
        payload: { orderedIds },
      });

      return reply.status(200).send({
        success: true,
        message: 'Urutan contoh percakapan berhasil diperbarui!',
        data: reordered,
      });
    }
  );

  /**
   * PUT /api/admin/few-shots/:id
   */
  fastify.put(
    '/api/admin/few-shots/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
        Body: {
          scenario?: string;
          customerMessage?: string;
          idealResponse?: string;
          tags?: string[];
          isActive?: boolean;
          sortOrder?: number;
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { id } = request.params;
      const body = request.body || {};

      const cleanUpdate: {
        scenario?: string;
        customerMessage?: string;
        idealResponse?: string;
        tags?: string[];
        isActive?: boolean;
        sortOrder?: number;
      } = {};
      if (body.scenario !== undefined) {
        const s = typeof body.scenario === 'string' ? body.scenario.trim() : '';
        if (!s) return reply.status(400).send({ error: 'Skenario tidak boleh kosong' });
        if (s.length > 150) return reply.status(400).send({ error: 'Skenario melebihi 150 karakter' });
        cleanUpdate.scenario = s;
      }
      if (body.customerMessage !== undefined) {
        const s = typeof body.customerMessage === 'string' ? body.customerMessage.trim() : '';
        if (!s) return reply.status(400).send({ error: 'Pesan pasien tidak boleh kosong' });
        if (s.length > 500) return reply.status(400).send({ error: 'Pesan pasien melebihi 500 karakter' });
        cleanUpdate.customerMessage = s;
      }
      if (body.idealResponse !== undefined) {
        const s = typeof body.idealResponse === 'string' ? body.idealResponse.trim() : '';
        if (!s) return reply.status(400).send({ error: 'Respon ideal tidak boleh kosong' });
        if (s.length > 1000) return reply.status(400).send({ error: 'Respon ideal melebihi 1000 karakter' });
        cleanUpdate.idealResponse = s;
      }
      if (body.tags !== undefined) {
        cleanUpdate.tags = Array.isArray(body.tags)
          ? body.tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim().toLowerCase()).filter(Boolean)
          : [];
      }
      if (body.isActive !== undefined) cleanUpdate.isActive = body.isActive !== false;
      if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))) {
        cleanUpdate.sortOrder = Number(body.sortOrder);
      }

      const { FewShotExemplarBank } = await import('../../../v3/agent/few-shot-exemplars');
      const updated = await FewShotExemplarBank.updateExemplar(id, cleanUpdate, tenantId);

      if (!updated) {
        return reply.status(404).send({ error: 'Contoh percakapan tidak ditemukan' });
      }

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_UPDATE',
        targetId: id,
        payload: request.body,
      });

      return reply.status(200).send({
        success: true,
        message: 'Contoh percakapan berhasil diperbarui!',
        data: updated,
      });
    }
  );

  /**
   * DELETE /api/admin/few-shots/:id
   */
  fastify.delete(
    '/api/admin/few-shots/:id',
    async (
      request: FastifyRequest<{
        Params: { id: string };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { id } = request.params;
      const { FewShotExemplarBank } = await import('../../../v3/agent/few-shot-exemplars');
      await FewShotExemplarBank.deleteExemplar(id, tenantId);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_DELETE',
        targetId: id,
      });

      return reply.status(200).send({
        success: true,
        message: 'Contoh percakapan berhasil dihapus!',
      });
    }
  );

  /**
   * POST /api/admin/few-shots/reset-defaults — pulihkan contoh SOP klinik
   * bawaan secara additive (contoh kustom admin dipertahankan).
   */
  fastify.post(
    '/api/admin/few-shots/reset-defaults',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { FewShotExemplarBank } = await import('../../../v3/agent/few-shot-exemplars');
      const defaults = await FewShotExemplarBank.resetToDefaults(tenantId);

      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'FEW_SHOT_RESET',
        targetId: 'ALL',
      });

      return reply.status(200).send({
        success: true,
        message: 'Contoh SOP klinik berhasil dipulihkan (contoh kustom tetap dipertahankan)!',
        data: defaults,
      });
    }
  );

  /**
   * GET /api/admin/ai-models
   */
  fastify.get('/api/admin/ai-models', async (request: FastifyRequest, reply: FastifyReply) => {
    const { AiModelConfigService } = await import('../../../config/ai-models.config');
    const configs = AiModelConfigService.getAllTaskConfigs();
    const activeProvider = AiModelConfigService.getActiveProvider();
    const endpointConfig = AiModelConfigService.getActiveEndpointConfig();

    return reply.status(200).send({
      success: true,
      data: configs,
      activeProvider,
      activeEndpoint: {
        provider: endpointConfig.provider,
        baseUrl: endpointConfig.baseUrl,
        defaultModel: endpointConfig.defaultModel,
      },
      providersStatus: buildProvidersStatus(activeProvider),
    });
  });

  /**
   * PATCH /api/admin/ai-models/provider
   * Mengganti provider AI aktif (Kenari vs SumoPod) dengan 1 klik.
   */
  fastify.patch(
    '/api/admin/ai-models/provider',
    async (
      request: FastifyRequest<{
        Body: { provider: 'KENARI' | 'SUMOPOD' };
      }>,
      reply: FastifyReply
    ) => {
      const { provider } = request.body || {};
      const upperProvider = (provider || '').toUpperCase();

      if (upperProvider !== 'KENARI' && upperProvider !== 'SUMOPOD') {
        return reply.status(400).send({
          error: "Bad Request: Provider tidak valid. Pilihan yang diizinkan: 'KENARI' atau 'SUMOPOD'.",
        });
      }

      const tenantId = resolveTenantId(request);
      const { AiModelConfigService } = await import('../../../config/ai-models.config');
      const oldProvider = AiModelConfigService.getActiveProvider(tenantId);

      try {
        await AiModelConfigService.setActiveProvider(tenantId, upperProvider as 'KENARI' | 'SUMOPOD');
        const activeEndpoint = AiModelConfigService.getActiveEndpointConfig(tenantId);
        const chatConfig = AiModelConfigService.getModelConfig('CHAT_REPLY', tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_PROVIDER_SWITCH',
          targetId: tenantId,
          payload: {
            oldProvider,
            newProvider: upperProvider,
            endpoint: activeEndpoint.baseUrl,
            model: chatConfig.modelName,
            switchedAt: new Date(),
            tenantId,
          },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `Provider LLM berhasil diubah ke ${upperProvider} (${activeEndpoint.baseUrl}). Model utama disesuaikan ke ${chatConfig.modelName}.`,
          activeProvider: upperProvider,
          activeEndpoint,
          configs: AiModelConfigService.getAllTaskConfigs(tenantId),
          providersStatus: buildProvidersStatus(upperProvider),
        });
      } catch (err: any) {
        return reply.status(400).send({
          error: err.message || 'Bad Request: Gagal mengganti provider LLM.',
        });
      }
    }
  );

  /**
   * POST /api/admin/ai-models/test
   * Uji respon mini simulator 1-detik: menjalankan inferensi singkat dan mengukur latensi.
   */
  fastify.post(
    '/api/admin/ai-models/test',
    async (
      request: FastifyRequest<{
        Body: { provider?: string; modelName?: string; sampleScenario?: 'flu' | 'price' | 'schedule' };
      }>,
      reply: FastifyReply
    ) => {
      const { provider, modelName, sampleScenario } = request.body || {};
      const scenario = sampleScenario || 'flu';
      const scenarioPrompts: Record<string, string> = {
        flu: 'Halo dok, si kecil batuk pilek semalam, treatment apa yang cocok ya?',
        price: 'Berapa harga pijat bayi pulih ceria ya?',
        schedule: 'Besok bisa jadwal sore jam berapa ya?',
      };
      const prompt = scenarioPrompts[scenario] || scenarioPrompts.flu;

      try {
        const { getLlmEndpointConfig } = await import('../../../integrations/llm/llm-gateway');
        const { callChatCompletionsWithFallback } = await import('../../../integrations/llm/model-fallback');
        const { AiModelConfigService: AiCfg } = await import('../../../config/ai-models.config');
        const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
        const activeProvider = AiCfg.getActiveProvider(tenantId);
        const targetProvider = (provider || activeProvider).toUpperCase();
        const targetBaseUrl = (targetProvider === 'SUMOPOD'
          ? (process.env.SUMOPOD_BASE_URL || 'https://ai.sumopod.com/v1')
          : (process.env.KENARI_BASE_URL || 'https://kenari.id/v1')
        ).replace(/\/$/, '');
        const targetApiKey = targetProvider === 'SUMOPOD'
          ? (process.env.SUMOPOD_API_KEY || (activeProvider === 'SUMOPOD' ? (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY) : ''))
          : (process.env.KENARI_API_KEY || (activeProvider === 'KENARI' ? (process.env.LLM_API_KEY || process.env.OPENAI_API_KEY) : ''));
        if (!targetApiKey) {
          return reply.status(200).send({
            success: false,
            error: `Kunci API ${targetProvider} belum terkonfigurasi. Periksa .env (${targetProvider === 'SUMOPOD' ? 'SUMOPOD_API_KEY' : 'KENARI_API_KEY'}).`,
            modelUsed: modelName || AiCfg.getActiveEndpointConfig(tenantId).defaultModel,
            providerUsed: targetProvider,
          });
        }
        const endpoint = getLlmEndpointConfig({
          tenantId,
          apiKey: targetApiKey,
          model: modelName,
          baseUrl: targetBaseUrl,
        });

        if (!endpoint.apiKey) {
          return reply.status(200).send({
            success: false,
            error: `Kunci API ${targetProvider} belum terkonfigurasi. Periksa .env (${targetProvider === 'SUMOPOD' ? 'SUMOPOD_API_KEY' : 'KENARI_API_KEY'}).`,
            modelUsed: endpoint.model,
            providerUsed: targetProvider,
          });
        }

        const start = Date.now();
        const result = await Promise.race([
          callChatCompletionsWithFallback({
            baseUrl: endpoint.baseUrl,
            apiKey: endpoint.apiKey,
            model: endpoint.model,
            fallbackModel: endpoint.fallbackModel,
            payload: {
              messages: [
                { role: 'system', content: 'Kamu adalah Bidan Yusi, bidan ramah klinik Mom & Baby. Jawab singkat 2-3 kalimat, hangat, pakai sapaan Bunda.' },
                { role: 'user', content: prompt },
              ],
              temperature: 0.6,
              max_tokens: 180,
            },
            timeoutMs: 10000,
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Koneksi timeout (10 detik) — model tidak merespons tepat waktu.')), 10000)),
        ]);
        const latencyMs = Date.now() - start;
        const rawContent = (result as any)?.data?.choices?.[0]?.message?.content || (result as any)?.choices?.[0]?.message?.content || (result as any)?.content || '';
        const trimmed = String(rawContent).slice(0, 320) || 'Halo Bunda! Terima kasih sudah menghubungi klinik kami 😊';
        const tokenEstimate = Math.ceil(trimmed.length / 4);
        return reply.status(200).send({
          success: true,
          latencyMs,
          replySnippet: trimmed,
          tokenEstimate,
          modelUsed: endpoint.model,
          providerUsed: endpoint.baseUrl.includes('sumopod') ? 'SUMOPOD' : 'KENARI',
        });
      } catch (err: any) {
        const msg = err.message || String(err);
        const friendly = msg.includes('timeout') ? 'Koneksi timeout atau kunci API tidak valid' : msg.includes('401') ? 'Kunci API tidak valid (401 Unauthorized)' : msg.includes('404') ? 'Model tidak ditemukan di provider ini' : msg;
        return reply.status(200).send({ success: false, error: friendly, latencyMs: null });
      }
    }
  );

  /**
   * PUT /api/admin/ai-models/batch
   * Simpan banyak task sekaligus dalam 1 request (transaksi terpadu).
   */
  fastify.put(
    '/api/admin/ai-models/batch',
    async (
      request: FastifyRequest<{
        Body: { configs?: Array<{ task: string; provider?: string; modelName?: string; maxTokens?: number; temperature?: number; confidenceThreshold?: number }>; presetId?: string; activeProvider?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { configs, presetId, activeProvider: bodyActiveProvider } = request.body || {};
      const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
      const { AiModelConfigService, AI_PRESET_PROFILES } = await import('../../../config/ai-models.config');

      try {
        if (presetId && (AI_PRESET_PROFILES as any)[presetId]) {
          AiModelConfigService.applyPresetProfile(presetId, tenantId);
        }
        if (Array.isArray(configs) && configs.length > 0) {
          for (const c of configs) {
            if (!c.task) continue;
            const upper = String(c.task).toUpperCase();
            if (upper === 'MEDICAL_CHECK') continue;
            const updates: any = {};
            if (c.provider) updates.provider = c.provider;
            if (c.modelName) updates.modelName = c.modelName;
            if (c.maxTokens !== undefined) updates.maxTokens = Number(c.maxTokens);
            if (c.temperature !== undefined) updates.temperature = Number(c.temperature);
            if (c.confidenceThreshold !== undefined) updates.confidenceThreshold = Number(c.confidenceThreshold);
            AiModelConfigService.updateTaskConfig(upper as any, updates, tenantId, { persist: false });
          }
        } else if (!presetId) {
          return reply.status(400).send({ success: false, error: 'Body harus berisi configs[] atau presetId.' });
        }

        if (bodyActiveProvider && ['KENARI', 'SUMOPOD'].includes(String(bodyActiveProvider).toUpperCase())) {
          AiModelConfigService.activeLlmProvider.set(tenantId, String(bodyActiveProvider).toUpperCase() as 'KENARI' | 'SUMOPOD');
        } else if (Array.isArray(configs) && configs.length > 0) {
          const chatCfg = configs.find((c: any) => String(c.task).toUpperCase() === 'CHAT_REPLY' && c.provider);
          if (chatCfg && chatCfg.provider) {
            const p = String(chatCfg.provider).toUpperCase();
            if (p === 'KENARI' || p === 'SUMOPOD') {
              AiModelConfigService.activeLlmProvider.set(tenantId, p as 'KENARI' | 'SUMOPOD');
            } else if (p.includes('KENARI')) {
              AiModelConfigService.activeLlmProvider.set(tenantId, 'KENARI');
            } else if (p.includes('SUMOPOD')) {
              AiModelConfigService.activeLlmProvider.set(tenantId, 'SUMOPOD');
            }
          }
        }

        const persisted = await AiModelConfigService.saveConfigsToDb(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_MODEL_BATCH_UPDATE',
          targetId: 'ALL',
          payload: { presetId: presetId || null, configs: configs || [], persisted },
          ipAddress: request.ip,
        });

        if (!persisted) {
          return reply.status(200).send({
            success: true,
            persisted: false,
            warning: 'Perubahan diterapkan di memori tetapi GAGAL tersimpan ke database (DB offline?). Cek log server lalu coba lagi — refresh akan mengembalikan nilai lama.',
            message: 'Perubahan diterapkan di memori tetapi GAGAL tersimpan ke database.',
            data: AiModelConfigService.getAllTaskConfigs(tenantId),
            activeProvider: AiModelConfigService.getActiveProvider(tenantId),
          });
        }

        return reply.status(200).send({
          success: true,
          persisted: true,
          message: presetId ? `Preset ${presetId} diterapkan dan konfigurasi disimpan.` : 'Konfigurasi AI batch berhasil disimpan.',
          data: AiModelConfigService.getAllTaskConfigs(tenantId),
          activeProvider: AiModelConfigService.getActiveProvider(tenantId),
        });
      } catch (err: any) {
        return reply.status(400).send({ success: false, error: err.message || 'Gagal menyimpan batch.' });
      }
    }
  );

  /**
   * POST /api/admin/ai-models/reset-defaults
   * Kembalikan semua task ke setelan emas klinik.
   */
  fastify.post('/api/admin/ai-models/reset-defaults', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
    const { AiModelConfigService } = await import('../../../config/ai-models.config');
    try {
      const configs = await AiModelConfigService.resetToGoldenDefaults(tenantId);
      await auditService.logAdminAction({
        apiKey: (request as any).adminKeyUsed,
        adminIdentity: (request as any).adminIdentity,
        action: 'AI_MODEL_RESET_DEFAULTS',
        targetId: tenantId,
        payload: { resetAt: new Date(), tenantId },
        ipAddress: request.ip,
      });
      return reply.status(200).send({
        success: true,
        message: 'Konfigurasi AI berhasil dikembalikan ke rekomendasi default klinik.',
        data: configs,
        activeProvider: AiModelConfigService.getActiveProvider(tenantId),
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  /**
   * PATCH /api/admin/ai-models/:task
   */
  fastify.patch(
    '/api/admin/ai-models/:task',
    async (
      request: FastifyRequest<{
        Params: { task: string };
        Body: { provider?: string; modelName?: string; maxTokens?: number; temperature?: number };
      }>,
      reply: FastifyReply
    ) => {
      const { task } = request.params;
      const upperTask = task.toUpperCase();

      if (upperTask === 'MEDICAL_CHECK') {
        return reply.status(400).send({
          error:
            'Bad Request: Deteksi medis (MEDICAL_CHECK) bersifat deterministik (Regex/Keywords) demi keselamatan customer dan tidak dapat diubah via model AI dinamis.',
        });
      }

      const { AiModelConfigService } = await import('../../../config/ai-models.config');
      const oldConfig = AiModelConfigService.getModelConfig(upperTask as any);

      try {
        const tenantId = (request as any).tenantId || DEFAULT_TENANT_ID;
        const updated = AiModelConfigService.updateTaskConfig(upperTask as any, request.body || {}, tenantId, { persist: false });
        const persisted = await AiModelConfigService.saveConfigsToDb(tenantId);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'AI_MODEL_CONFIG_CHANGE',
          targetId: upperTask,
          payload: {
            task: upperTask,
            oldConfig: { provider: oldConfig.provider, modelName: oldConfig.modelName },
            newConfig: { provider: updated.provider, modelName: updated.modelName },
            persisted,
            changedAt: new Date(),
          },
          ipAddress: request.ip,
        });

        if (!persisted) {
          return reply.status(200).send({
            success: true,
            persisted: false,
            warning: 'Perubahan diterapkan di memori tetapi GAGAL tersimpan ke database (DB offline?).',
            message: `Model AI untuk task ${upperTask} diterapkan di memori tetapi GAGAL tersimpan ke database. Audit trail telah dicatat.`,
            data: updated,
          });
        }

        return reply.status(200).send({
          success: true,
          persisted: true,
          message: `Model AI untuk task ${upperTask} berhasil diubah ke ${updated.provider}/${updated.modelName}. Audit trail telah dicatat.`,
          data: updated,
        });
      } catch (err: any) {
        return reply.status(400).send({
          error: err.message || 'Bad Request: Perubahan konfigurasi model AI gagal.',
        });
      }
    }
  );

  /**
   * GET /api/admin/ai-rollout-scope
   */
  fastify.get('/api/admin/ai-rollout-scope', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = resolveTenantId(request);
      const { AiEligibilityConfigService } = await import('../../../config/ai-eligibility-config');
      const cfg = AiEligibilityConfigService.getConfig(tenantId);

      let summary = { totalCustomers: 0, newCustomers: 0, legacyCustomers: 0, silencedByScope: 0 };
      try {
        const [totalCustomers, newCustomers, silencedByScope] = await Promise.all([
          prisma.customer.count({ where: { tenant_id: tenantId } }),
          prisma.customer.count({
            where: { tenant_id: tenantId, created_at: { gte: cfg.ai_scope_cutoff_at } },
          }),
          prisma.conversation.count({
            where: {
              tenant_id: tenantId,
              is_human_handling: true,
              escalation_reason: AI_ELIGIBILITY_ESCALATION_REASON,
            },
          }),
        ]);
        summary = {
          totalCustomers,
          newCustomers,
          legacyCustomers: Math.max(0, totalCustomers - newCustomers),
          silencedByScope,
        };
      } catch (dbErr: any) {
        console.warn('[AI ROLLOUT SCOPE] DB offline, summary di-skip:', dbErr.message);
      }

      return reply.status(200).send({ success: true, data: cfg, summary });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  /**
   * PATCH /api/admin/ai-rollout-scope
   */
  fastify.patch(
    '/api/admin/ai-rollout-scope',
    async (
      request: FastifyRequest<{
        Body: {
          aiCustomerScope?: 'NEW_ONLY' | 'ALL';
          aiScopeCutoffAt?: string;
          legacyBypassBot?: boolean;
          repeatPatientBypassBot?: boolean;
        };
      }>,
      reply: FastifyReply
    ) => {
      const body = request.body || {};
      const patch: {
        ai_customer_scope?: 'NEW_ONLY' | 'ALL';
        ai_scope_cutoff_at?: Date;
        legacy_bypass_bot?: boolean;
        repeat_patient_bypass_bot?: boolean;
      } = {};

      if (body.aiCustomerScope === 'NEW_ONLY' || body.aiCustomerScope === 'ALL') {
        patch.ai_customer_scope = body.aiCustomerScope;
      }
      if (body.aiScopeCutoffAt && !isNaN(Date.parse(body.aiScopeCutoffAt))) {
        patch.ai_scope_cutoff_at = new Date(body.aiScopeCutoffAt);
      }
      if (typeof body.legacyBypassBot === 'boolean') {
        patch.legacy_bypass_bot = body.legacyBypassBot;
      }
      if (typeof body.repeatPatientBypassBot === 'boolean') {
        patch.repeat_patient_bypass_bot = body.repeatPatientBypassBot;
      }

      if (Object.keys(patch).length === 0) {
        return reply
          .status(400)
          .send({ error: 'Body harus berisi aiCustomerScope, aiScopeCutoffAt, legacyBypassBot, atau repeatPatientBypassBot.' });
      }

      const tenantId = resolveTenantId(request);
      try {
        const { AiEligibilityConfigService } = await import('../../../config/ai-eligibility-config');
        const cfg = await AiEligibilityConfigService.saveConfig(tenantId, patch);

        await auditService.logAdminAction({
          apiKey: (request as any).adminKeyUsed,
          adminIdentity: (request as any).adminIdentity,
          action: 'UPDATE_AI_ROLLOUT_SCOPE',
          targetId: tenantId,
          payload: { ...cfg, tenantId },
          ipAddress: request.ip,
        });

        return reply.status(200).send({
          success: true,
          message: `AI Rollout Scope diperbarui: scope=${cfg.ai_customer_scope}, cutoff=${cfg.ai_scope_cutoff_at.toISOString()}, legacyBypass=${cfg.legacy_bypass_bot}, repeatBypass=${cfg.repeat_patient_bypass_bot}.`,
          data: cfg,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  /**
   * GET /api/admin/conversation-behavior
   */
  fastify.get('/api/admin/conversation-behavior', async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = resolveTenantId(request);
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { idle_greeting_enabled: true, idle_greeting_min_hours: true },
      });
      return reply.status(200).send({
        success: true,
        data: {
          idleGreeting: {
            enabled: tenant?.idle_greeting_enabled ?? inMemoryConversationBehavior[tenantId]?.enabled ?? true,
            minHours: tenant?.idle_greeting_min_hours ?? inMemoryConversationBehavior[tenantId]?.minHours ?? 24,
          },
        },
      });
    } catch {
      return reply.status(200).send({
        success: true,
        data: {
          idleGreeting: {
            enabled: inMemoryConversationBehavior[tenantId]?.enabled ?? true,
            minHours: inMemoryConversationBehavior[tenantId]?.minHours ?? 24,
          },
        },
      });
    }
  });

  /**
   * PATCH /api/admin/conversation-behavior
   */
  fastify.patch(
    '/api/admin/conversation-behavior',
    async (
      request: FastifyRequest<{
        Body: {
          idleGreeting?: { enabled?: boolean; minHours?: number };
        };
      }>,
      reply: FastifyReply
    ) => {
      const tenantId = resolveTenantId(request);
      const body = request.body || {};
      const enabled = body.idleGreeting?.enabled;
      const minHours = body.idleGreeting?.minHours;

      if (!inMemoryConversationBehavior[tenantId]) {
        inMemoryConversationBehavior[tenantId] = { enabled: true, minHours: 24 };
      }
      if (enabled !== undefined) inMemoryConversationBehavior[tenantId].enabled = enabled;
      if (minHours !== undefined) inMemoryConversationBehavior[tenantId].minHours = minHours;

      try {
        const updateData: any = {};
        if (enabled !== undefined) updateData.idle_greeting_enabled = enabled;
        if (minHours !== undefined) updateData.idle_greeting_min_hours = minHours;

        const tenant = await prisma.tenant.upsert({
          where: { id: tenantId },
          create: {
            id: tenantId,
            slug: tenantId,
            name: `Clinic ${tenantId}`,
            ...updateData,
          },
          update: updateData,
          select: { idle_greeting_enabled: true, idle_greeting_min_hours: true },
        });

        return reply.status(200).send({
          success: true,
          message: 'Konfigurasi perilaku percakapan diperbarui.',
          data: {
            idleGreeting: {
              enabled: tenant.idle_greeting_enabled,
              minHours: tenant.idle_greeting_min_hours,
            },
          },
        });
      } catch {
        return reply.status(200).send({
          success: true,
          message: 'Konfigurasi perilaku percakapan diperbarui (in-memory mode).',
          data: {
            idleGreeting: {
              enabled: inMemoryConversationBehavior[tenantId].enabled,
              minHours: inMemoryConversationBehavior[tenantId].minHours,
            },
          },
        });
      }
    }
  );
}
