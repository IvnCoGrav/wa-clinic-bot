/**
 * Utilitas untuk menghitung jarak antara dua koordinat geografis (Latitude/Longitude)
 * menggunakan rumus Haversine. Hasil dikembalikan dalam satuan Kilometer (km).
 */

export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Menghitung jarak Haversine (Great-circle distance) dalam Kilometer.
 * 
 * @param point1 Koordinat titik asal (misal: Klinik)
 * @param point2 Koordinat titik tujuan (misal: Customer)
 * @returns Jarak dalam km (dibulatkan ke 2 desimal untuk konsistensi tampilan)
 */
export function calculateHaversineDistance(point1: Coordinates, point2: Coordinates): number {
  const EARTH_RADIUS_KM = 6371.0; // Jari-jari bumi rata-rata dalam kilometer

  const dLat = toRadians(point2.lat - point1.lat);
  const dLng = toRadians(point2.lng - point1.lng);

  const lat1Rad = toRadians(point1.lat);
  const lat2Rad = toRadians(point2.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = EARTH_RADIUS_KM * c;

  // Dibulatkan ke 2 desimal (misal 5.004 -> 5.0, 5.012 -> 5.01)
  return Math.round(distance * 100) / 100;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
