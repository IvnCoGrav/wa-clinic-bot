export interface CaptionSplitResult {
  imageCaption?: string;
  followUpTexts: string[];
}

/**
 * Smart Caption Splitter untuk WhatsApp:
 * WhatsApp membatasi caption gambar maks ~1024 karakter.
 * Fungsi ini memecah teks pesan menjadi caption gambar (maks threshold char, default 1000)
 * dan array follow-up teks untuk sisa konten yang melebihi batas.
 */
export function splitImageCaption(text: string | undefined | null, threshold = 1000): CaptionSplitResult {
  if (!text || !text.trim()) {
    return { imageCaption: undefined, followUpTexts: [] };
  }
  const clean = text.trim();
  if (clean.length <= threshold) {
    return { imageCaption: clean, followUpTexts: [] };
  }

  // Cari titik potong terbaik sebelum atau pada threshold
  // Urutan prioritas: double newline (\n\n), single newline (\n), spasi (' ')
  let splitIdx = clean.lastIndexOf('\n\n', threshold);
  if (splitIdx < threshold * 0.4) {
    splitIdx = clean.lastIndexOf('\n', threshold);
  }
  if (splitIdx < threshold * 0.4) {
    splitIdx = clean.lastIndexOf(' ', threshold);
  }
  if (splitIdx <= 0) {
    splitIdx = threshold;
  }

  const imageCaption = clean.slice(0, splitIdx).trim();
  const remaining = clean.slice(splitIdx).trim();

  const followUpTexts: string[] = [];
  if (remaining.length > 0) {
    let rest = remaining;
    const maxFollowUpChunk = 4000; // Batas wajar pesan teks WhatsApp (~4096 char)
    while (rest.length > 0) {
      if (rest.length <= maxFollowUpChunk) {
        followUpTexts.push(rest);
        break;
      }
      let nextSplit = rest.lastIndexOf('\n\n', maxFollowUpChunk);
      if (nextSplit < maxFollowUpChunk * 0.4) nextSplit = rest.lastIndexOf('\n', maxFollowUpChunk);
      if (nextSplit < maxFollowUpChunk * 0.4) nextSplit = rest.lastIndexOf(' ', maxFollowUpChunk);
      if (nextSplit <= 0) nextSplit = maxFollowUpChunk;
      followUpTexts.push(rest.slice(0, nextSplit).trim());
      rest = rest.slice(nextSplit).trim();
    }
  }

  return {
    imageCaption: imageCaption || undefined,
    followUpTexts,
  };
}
