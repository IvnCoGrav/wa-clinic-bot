/**
 * Utility untuk memotong/mengkategorikan dokumen teks menjadi potongan chunk 
 * berukuran ~500 - 800 karakter tanpa memotong kalimat di tengah.
 */
export function chunkTextDocument(
  text: string,
  minChunkSize = 400,
  maxChunkSize = 800
): string[] {
  if (!text || text.trim().length === 0) return [];

  // 1. Split berdasarkan paragraf (\n\n atau \r\n\r\n)
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let currentChunk = '';

  for (const para of paragraphs) {
    // Jika ditambahkan paragraf ini masih di bawah maxChunkSize
    if ((currentChunk + '\n\n' + para).trim().length <= maxChunkSize) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
    } else {
      // Jika paragraf sendiri sudah terlalu panjang (> maxChunkSize), split berdasarkan kalimat
      if (para.length > maxChunkSize) {
        const sentences = para.match(/[^.!?]+[.!?]+(\s+|$)/g) || [para];
        for (const sentence of sentences) {
          if ((currentChunk + ' ' + sentence).trim().length <= maxChunkSize) {
            currentChunk = currentChunk ? `${currentChunk} ${sentence.trim()}` : sentence.trim();
          } else {
            if (currentChunk) chunks.push(currentChunk.trim());
            currentChunk = sentence.trim();
          }
        }
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = para;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
