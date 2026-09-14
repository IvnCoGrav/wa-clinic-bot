/**
 * imageWatermark.ts
 * Stamping watermark GPS, kelurahan/kecamatan, patokan, dan timestamp langsung di sisi client via Canvas.
 * Memastikan staf dan admin dapat langsung melihat pratinjau foto ber-watermark di browser sebelum disimpan.
 */

export interface WatermarkInfo {
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  kelurahan?: string | null;
  kecamatan?: string | null;
  landmark?: string | null;
  customerName?: string | null;
  takerName?: string | null;
  staffName?: string | null;
  timestamp?: string;
}

/**
 * Menempelkan banner watermark GPS dan lokasi di bagian bawah foto secara instan di canvas.
 */
export async function stampGpsWatermark(
  dataUrlOrImg: string,
  info: WatermarkInfo
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => resolve(dataUrlOrImg); // Fallback ke gambar asli jika gagal
    img.onload = () => {
      const width = img.width;
      const height = img.height;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve(dataUrlOrImg);
        return;
      }

      // 1. Gambar foto utama
      ctx.drawImage(img, 0, 0, width, height);

      // 2. Format Teks Watermark
      const dateObj = new Date();
      const timeStr =
        info.timestamp ||
        dateObj.toLocaleDateString('id-ID', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }) + ' WIB';

      const hasCoords = info.lat != null && info.lng != null;
      const latStr = hasCoords ? Number(info.lat).toFixed(6) : '';
      const lngStr = hasCoords ? Number(info.lng).toFixed(6) : '';

      const cleanKel = (info.kelurahan || '').trim();
      const cleanKec = (info.kecamatan || '').trim();
      const cleanLandmark = (info.landmark || '').trim();
      const cleanTaker = (info.takerName || info.staffName || '').trim();

      let areaText = '';
      if (cleanKel && cleanKec) {
        areaText = ` • Kel. ${cleanKel}, Kec. ${cleanKec}`;
      } else if (cleanKel || cleanKec) {
        areaText = ` • ${cleanKel || cleanKec}`;
      }

      let line1 = 'PANDUAN LOKASI PASIEN';
      if (hasCoords) {
        const accText = info.accuracy ? ` (±${info.accuracy}m)` : '';
        line1 = `GPS: ${latStr}, ${lngStr}${accText}${areaText}`;
      } else if (areaText) {
        line1 = `AREA:${areaText}`;
      }

      const parts: string[] = [];
      if (cleanTaker) {
        parts.push(`BIDAN: ${cleanTaker}`);
      }
      if (cleanLandmark) {
        const truncatedLandmark = cleanLandmark.length > 40 ? cleanLandmark.slice(0, 37) + '...' : cleanLandmark;
        parts.push(`Patokan: ${truncatedLandmark}`);
      } else if (info.customerName) {
        parts.push(`Bunda ${info.customerName}`);
      }
      parts.push(timeStr);

      const line2 = parts.join(' • ');

      // 3. Render Banner Semi-Transparan Proporsional
      const bannerHeight = Math.max(60, Math.round(height * 0.11));
      const bannerY = height - bannerHeight;

      // Dark translucent background bar
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'; // Slate-900 with 85% opacity
      ctx.fillRect(0, bannerY, width, bannerHeight);

      // Emerald brand accent top border
      ctx.fillStyle = '#00a884';
      ctx.fillRect(0, bannerY, width, Math.max(3, Math.round(bannerHeight * 0.05)));

      // Responsive font sizes (proporsional terhadap resolusi foto, tanpa pembatasan kaku 18px)
      const baseFontSize = Math.max(13, Math.min(32, Math.round(width * 0.024)));
      const subFontSize = Math.max(11, Math.min(26, Math.round(width * 0.019)));
      const brandFontSize = Math.max(12, Math.min(26, Math.round(baseFontSize * 0.85)));
      const paddingX = Math.max(14, Math.round(width * 0.025));

      // Ukur lebar Clinic Brand Stamp terlebih dahulu untuk mencegah tabrakan dengan line1
      ctx.font = `bold ${brandFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      const brandText = 'KALA MOMS & BABY';
      const brandWidth = ctx.measureText(brandText).width;
      const textY1 = bannerY + bannerHeight * 0.36;

      // Render Brand Stamp di kanan atas banner
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.textBaseline = 'middle';
      ctx.fillText(brandText, width - brandWidth - paddingX, textY1);

      // Line 1: Koordinat & Wilayah (Bold White) dengan Dynamic Clipping agar tidak menimpa brand
      const maxLine1Width = Math.max(100, width - brandWidth - (paddingX * 2.8));
      ctx.font = `bold ${baseFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = '#ffffff';

      let displayLine1 = line1;
      if (ctx.measureText(displayLine1).width > maxLine1Width) {
        while (displayLine1.length > 8 && ctx.measureText(displayLine1 + '...').width > maxLine1Width) {
          displayLine1 = displayLine1.slice(0, -1);
        }
        displayLine1 += '...';
      }
      ctx.fillText(displayLine1, paddingX, textY1);

      // Line 2: Bidan / Patokan & Tanggal Jam (Subtle Mint/Slate) dengan Dynamic Clipping
      const maxLine2Width = width - (paddingX * 2);
      ctx.font = `normal ${subFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = '#cbd5e1'; // Slate-300
      const textY2 = bannerY + bannerHeight * 0.72;

      let displayLine2 = line2;
      if (ctx.measureText(displayLine2).width > maxLine2Width) {
        while (displayLine2.length > 10 && ctx.measureText(displayLine2 + '...').width > maxLine2Width) {
          displayLine2 = displayLine2.slice(0, -1);
        }
        displayLine2 += '...';
      }
      ctx.fillText(displayLine2, paddingX, textY2);

      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };

    img.src = dataUrlOrImg;
  });
}
