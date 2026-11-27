import { FastifyInstance } from 'fastify';

/**
 * GET /api/config/public — konfigurasi non-rahasia untuk dashboard saat runtime.
 *
 * M17-11: konfigurasi peta TIDAK BOLEH dibakar ke bundle lewat build-arg Vite.
 * Build-arg ikut tersimpan di layer image dan tidak bisa dirotasi tanpa rebuild.
 * Server mengirim URL basemap siap pakai (termasuk kunci peta sisi-klien) sehingga
 * bundle dashboard tidak memuat nama provider/kunci sama sekali — rotasi kunci
 * maupun ganti provider cukup lewat env server.
 *
 * Hanya nilai yang memang boleh tampil di klien publik yang dikembalikan.
 */
export async function publicConfigRoutes(fastify: FastifyInstance) {
  fastify.get('/api/config/public', async (_request, reply) => {
    // Kompatibilitas: server lama hanya punya VITE_CARTO_API_KEY di .env.
    const cartoApiKey = (process.env.CARTO_API_KEY || process.env.VITE_CARTO_API_KEY || '').trim();

    const basemapUrl = cartoApiKey
      ? `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoApiKey)}`
      : 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';

    const attribution = cartoApiKey
      ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      : '&copy; Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS User Community';

    reply.header('Cache-Control', 'public, max-age=300');
    return {
      map: {
        basemapUrl,
        attribution,
        // Esri hanya punya tile sampai zoom 16; CARTO sampai 20.
        maxNativeZoom: cartoApiKey ? 20 : 16,
        subdomains: cartoApiKey ? 'abcd' : null,
      },
    };
  });
}
