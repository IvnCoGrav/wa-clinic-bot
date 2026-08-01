process.env.NODE_ENV = 'test';
process.env.GOOGLE_MAPS_API_KEY = 'mock_google_maps_key';
const { DeliveryService } = require('C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/services/delivery.service');
const { calculateHaversineDistance } = require('C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/utils/haversine');
const { clinicConfig } = require('C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/config/clinic');
(async () => {
  const customer = { lat: -7.2354385, lng: 112.7911863 };
  const straight = calculateHaversineDistance(clinicConfig, customer);
  console.log("Haversine garis lurus:", straight.toFixed(2), "km");
  console.log("Fallback x1.5:", (straight * 1.5).toFixed(2), "km");
  const svc = new DeliveryService();
  const res = await svc.calculateDelivery(customer);
  console.log(JSON.stringify({ distanceKm: res.distanceKm, isEstimated: res.isEstimated, ongkir: res.ongkir, normalPrice: res.normalPrice, promoPrice: res.promoPrice, isOutOfCoverage: res.isOutOfCoverage }));
})();
