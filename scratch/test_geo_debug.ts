require('dotenv').config();
const { geocodingService } = require('C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/integrations/google-maps/geocoding');
(async () => {
  for (const t of ['gtau ah', 'di sana', 'ya gitu deh']) {
    const r = await geocodingService.geocodeText(t);
    console.log(JSON.stringify(t), '=>', JSON.stringify({ isPrecise: r.isPrecise, isLlmResolved: r.isLlmResolved, lat: r.lat, matchedSpan: r.matchedSpan, kota: r.kota, kelurahan: r.kelurahan }));
  }
})();
