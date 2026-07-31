process.env.GOOGLE_MAPS_API_KEY = 'mock_google_maps_key';
process.env.NODE_ENV = 'test';
const { geocodingService } = require('C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/integrations/google-maps/geocoding');
(async () => {
  for (const t of ['Prambon', 'Jabon', 'Wonocolo', 'Gedangan', 'Waru', 'Sedati', 'Krian']) {
    const r = await geocodingService.geocodeText('saya di ' + t + ' bund');
    console.log(t, '=>', JSON.stringify({ isPrecise: r.isPrecise, kelurahan: r.kelurahan, kecamatan: r.kecamatan, matchedSpan: r.matchedSpan, kota: r.kota, ambiguity: r.ambiguityResults?.length }));
  }
})();
