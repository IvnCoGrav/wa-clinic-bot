process.env.NODE_ENV = 'test';
process.env.GOOGLE_MAPS_API_KEY = 'mock_google_maps_key';
const { geocodingService } = require('C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/integrations/google-maps/geocoding');
(async () => {
  const r = await geocodingService.geocodeText('kenjeran bulak');
  console.log(JSON.stringify({ isPrecise: r.isPrecise, isFuzzyMatch: r.isFuzzyMatch, kelurahan: r.kelurahan, kecamatan: r.kecamatan, kota: r.kota, lat: r.lat, lng: r.lng, matchedSpan: r.matchedSpan, ambiguity: r.ambiguityResults?.length }));
})();
