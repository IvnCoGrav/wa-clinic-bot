/**
 * src/utils/pii-masker.ts
 * Menyensor nomor telepon, nama anak, dan detail alamat pada log audit & console.
 *
 * Kontrak masking:
 * - maskPhoneNumber: untuk log/audit (4 depan + **** + 3 belakang). Tetap dipertahankan.
 * - maskPhoneInText: untuk display staff (prefix + ***** untuk 5 digit terakhir). Sesuai permintaan
 *   enterprise PII — sensor 5 digit terakhir di bubble chat terapis, preservasi separator prefix.
 */

export function maskPhoneNumber(phone?: string | null): string {
  if (!phone || typeof phone !== 'string') return '';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.length <= 6) return '***';
  return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
}

/**
 * maskPhoneInText — sensor 5 digit terakhir nomor HP Indonesia di teks bebas.
 *
 * - Mendeteksi 08xx, +628xx, 628xx, wa.me/xxx, JID @c.us/@s.whatsapp.net/@lid
 * - Validasi: 10-15 digit, prefix 0→8 atau 62→8 (mobile Indonesia)
 * - Tidak menyentuh nominal harga (Rp 150.000), jam (08:00), tahun (2026), koordinat
 * - Preservasi separator prefix, tail diganti ***** (contoh: 0812-3456-7890 → 0812-345*****)
 */
export function maskPhoneInText(text: string): string {
  if (!text || typeof text !== 'string') return text ?? '';
  let out = text;

  // --- Helper: maskir satu segmen nomor (preservasi separator prefix + ***** tail) ---
  const maskSegment = (segment: string): string => {
    // Pisahkan prefix wa.me/
    let prefixLiteral = '';
    let numericPart = segment;
    const waPrefix = segment.match(/^wa\.me\//i);
    if (waPrefix) {
      prefixLiteral = waPrefix[0];
      numericPart = segment.slice(prefixLiteral.length);
    }
    // Pisahkan domain JID @c.us etc
    let domain = '';
    const atIdx = numericPart.indexOf('@');
    if (atIdx !== -1) {
      domain = numericPart.slice(atIdx);
      numericPart = numericPart.slice(0, atIdx);
    }
    // Hapus URL scheme sisa untuk https://wa.me/ — sudah di-handle prefixLiteral, tapi jika ada https://
    // numericPart mungkin diawali // — bersihkan
    numericPart = numericPart.replace(/^\/+/, '');

    const digitsOnly = numericPart.replace(/\D/g, '');
    if (digitsOnly.length < 10 || digitsOnly.length > 15) return segment;
    // Validasi prefix Indonesia: 0→8 atau 62→8
    if (digitsOnly.startsWith('0')) {
      if (digitsOnly[1] !== '8') return segment;
    } else if (digitsOnly.startsWith('62')) {
      if (digitsOnly[2] !== '8') return segment;
    } else {
      return segment;
    }

    const keepDigits = digitsOnly.length - 5;
    let digitCount = 0;
    let prefixStr = '';
    let plusIncluded = false;
    for (let i = 0; i < numericPart.length; i++) {
      const ch = numericPart[i];
      if (ch === '+' && digitCount === 0 && !plusIncluded) {
        if (digitCount < keepDigits || keepDigits === 0) {
          prefixStr += ch;
          plusIncluded = true;
        }
        continue;
      }
      if (/\d/.test(ch)) {
        digitCount++;
        if (digitCount <= keepDigits) {
          prefixStr += ch;
        } else {
          break;
        }
      } else {
        // separator (space, dash, dot, paren)
        if (digitCount < keepDigits) {
          prefixStr += ch;
        } else if (digitCount === keepDigits) {
          // jangan sertakan separator trailing setelah digit terakhir yang dipertahankan
          continue;
        }
      }
    }
    // Jika plus belum termasuk tapi numericPart diawali +, pastikan prefixStr diawali +
    if (numericPart.trim().startsWith('+') && !prefixStr.startsWith('+')) {
      prefixStr = '+' + prefixStr;
    }
    return prefixLiteral + prefixStr + '*****' + domain;
  };

  // 1) JID: 628xxx@c.us / @s.whatsapp.net / @lid (bisa dengan +)
  out = out.replace(/\+?\d[\d\s\-\.\(\)]*\d@(?:c\.us|s\.whatsapp\.net|lid)/gi, (m) => {
    const masked = maskSegment(m);
    // maskSegment untuk JID mengembalikan ***** + domain; pastikan tidak double-mask jika tidak valid
    return masked;
  });

  // 2) wa.me links — termasuk https://wa.me/...
  out = out.replace(/(?:https?:\/\/)?wa\.me\/\+?[\d\s\-\.\(\)]{7,}\d/gi, (m) => {
    // Untuk wa.me, maskSegment perlu handle prefixLiteral wa.me/
    // Ekstrak bagian wa.me/xxx saja untuk masking, preservasi scheme jika ada
    const schemeMatch = m.match(/^(https?:\/\/)/i);
    const scheme = schemeMatch ? schemeMatch[1] : '';
    const rest = scheme ? m.slice(scheme.length) : m;
    const maskedRest = maskSegment(rest);
    return scheme + maskedRest;
  });

  // 3) Generic Indonesian phones: +62 / 62 / 0 prefix
  // Pola menangkap nomor dengan separator spasi/dash/dot/parens minimal 10 digit total
  out = out.replace(/(?:\+62|62|0)[\d\s\-\.\(\)]{7,}\d/g, (m) => {
    // Validasi digit count sebelum maskir (hindari harga/jam)
    const digits = m.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) return m;
    if (digits.startsWith('0') && digits[1] !== '8') return m;
    if (digits.startsWith('62') && digits[2] !== '8') return m;
    if (!digits.startsWith('0') && !digits.startsWith('62')) return m;
    return maskSegment(m);
  });

  return out;
}

/**
 * sanitizePayloadRawForStaff — allowlist deterministik payload_raw untuk terapis.
 * Hanya field visual aman yang dipertahankan; JID teknis (from/to/author/_data/key/participant)
 * dan blob biner dihapus. Field yang mengandung nomor HP di-mask via maskPhoneInText.
 */
export function sanitizePayloadRawForStaff(payloadRaw: any): any {
  if (!payloadRaw || typeof payloadRaw !== 'object' || Array.isArray(payloadRaw)) return payloadRaw;
  const allowed: any = {};

  // Media
  if (payloadRaw.media && typeof payloadRaw.media === 'object' && !Array.isArray(payloadRaw.media)) {
    const m: any = payloadRaw.media;
    const filtered: any = {};
    if (m.url !== undefined) filtered.url = m.url;
    if (m.hdUrl !== undefined) filtered.hdUrl = m.hdUrl;
    if (m.thumbUrl !== undefined) filtered.thumbUrl = m.thumbUrl;
    if (m.mimeType !== undefined) filtered.mimeType = m.mimeType;
    if (m.fileName !== undefined) filtered.fileName = typeof m.fileName === 'string' ? maskPhoneInText(m.fileName) : m.fileName;
    if (m.caption !== undefined) filtered.caption = typeof m.caption === 'string' ? maskPhoneInText(m.caption) : m.caption;
    if (m.fileSize !== undefined) filtered.fileSize = m.fileSize;
    if (Object.keys(filtered).length) allowed.media = filtered;
  }

  // Location — promosikan dari berbagai sumber (_data.message.locationMessage etc)
  const locCandidate =
    payloadRaw.location ||
    payloadRaw._data?.message?.locationMessage ||
    payloadRaw._data?.message?.liveLocationMessage ||
    payloadRaw.message?.locationMessage ||
    payloadRaw.message?.liveLocationMessage ||
    payloadRaw._data?.location;
  if (locCandidate && typeof locCandidate === 'object') {
    const latRaw = (locCandidate as any).degreesLatitude ?? (locCandidate as any).latitude ?? (locCandidate as any).lat;
    const lngRaw = (locCandidate as any).degreesLongitude ?? (locCandidate as any).longitude ?? (locCandidate as any).lng;
    if (typeof latRaw === 'number' && typeof lngRaw === 'number' && !(latRaw === 0 && lngRaw === 0) && !isNaN(latRaw) && !isNaN(lngRaw)) {
      // P3-4: grid lat/lng untuk terapis (±1km, 2 desimal) — jangan kirim 6 desimal presisi rumah
      const lat = Math.round(latRaw * 100) / 100;
      const lng = Math.round(lngRaw * 100) / 100;
      const locFiltered: any = {
        latitude: lat,
        longitude: lng,
        lat,
        lng,
        degreesLatitude: lat,
        degreesLongitude: lng,
      };
      if ((locCandidate as any).isLive !== undefined) locFiltered.isLive = !!(locCandidate as any).isLive;
      else if (payloadRaw._data?.message?.liveLocationMessage || payloadRaw.message?.liveLocationMessage) locFiltered.isLive = true;
      if (typeof (locCandidate as any).address === 'string') locFiltered.address = maskAddress(maskPhoneInText((locCandidate as any).address));
      else if ((locCandidate as any).address) locFiltered.address = (locCandidate as any).address;
      if (typeof (locCandidate as any).name === 'string') locFiltered.name = maskPhoneInText((locCandidate as any).name);
      else if ((locCandidate as any).name) locFiltered.name = (locCandidate as any).name;
      if ((locCandidate as any).url) locFiltered.url = (locCandidate as any).url;
      allowed.location = locFiltered;
    }
  }

  // Contact
  const contactSrc = payloadRaw.contact;
  if (contactSrc && typeof contactSrc === 'object' && !Array.isArray(contactSrc)) {
    const c: any = contactSrc;
    const filtered: any = {};
    if (c.name) filtered.name = c.name;
    if (c.displayName) filtered.displayName = c.displayName;
    if (c.display_name) filtered.display_name = c.display_name;
    if (c.phone) filtered.phone = maskPhoneInText(String(c.phone));
    if (c.phoneNumber) filtered.phoneNumber = maskPhoneInText(String(c.phoneNumber));
    if (c.phone_number) filtered.phone_number = maskPhoneInText(String(c.phone_number));
    // Pertahankan displayName fallback
    if (!filtered.name && filtered.displayName) filtered.name = filtered.displayName;
    if (Object.keys(filtered).length) allowed.contact = filtered;
  }

  // Quoted message — berbagai alias
  const qRaw =
    payloadRaw.quoted_message ||
    payloadRaw.quotedMessage ||
    payloadRaw.quoted ||
    payloadRaw.reply_to_message ||
    payloadRaw.quotedMsg ||
    payloadRaw._data?.quotedMsg;
  if (qRaw && typeof qRaw === 'object' && !Array.isArray(qRaw)) {
    const q: any = qRaw;
    const filtered: any = {};
    if (q.id) filtered.id = q.id;
    if (q.wa_message_id) filtered.wa_message_id = q.wa_message_id;
    if (q.waMessageId) filtered.waMessageId = q.waMessageId;
    if (q.sender_name) filtered.sender_name = maskPhoneInText(String(q.sender_name));
    if (q.senderName) filtered.senderName = maskPhoneInText(String(q.senderName));
    if (q.sender_type) filtered.sender_type = q.sender_type;
    if (q.senderType) filtered.senderType = q.senderType;
    if (q.direction) filtered.direction = q.direction;
    if (q.content) filtered.content = maskPhoneInText(String(q.content));
    else if (q.text) filtered.content = maskPhoneInText(String(q.text));
    if (q.text && !filtered.content) filtered.text = maskPhoneInText(String(q.text));
    if (q.caption) filtered.caption = maskPhoneInText(String(q.caption));
    if (q.media && typeof q.media === 'object') {
      const mq: any = q.media;
      const mf: any = {};
      if (mq.url) mf.url = mq.url;
      if (mq.hdUrl) mf.hdUrl = mq.hdUrl;
      if (mq.thumbUrl) mf.thumbUrl = mq.thumbUrl;
      if (mq.mimeType) mf.mimeType = mq.mimeType;
      if (mq.caption) mf.caption = maskPhoneInText(String(mq.caption));
      if (Object.keys(mf).length) filtered.media = mf;
    }
    if (Object.keys(filtered).length) allowed.quoted_message = filtered;
  }

  // Type flags
  if (payloadRaw.type !== undefined) allowed.type = payloadRaw.type;
  if (payloadRaw.canonicalType !== undefined) allowed.canonicalType = payloadRaw.canonicalType;
  if (payloadRaw.isPtt !== undefined) allowed.isPtt = payloadRaw.isPtt;
  if (payloadRaw.is_revoked !== undefined) allowed.is_revoked = payloadRaw.is_revoked;
  if (payloadRaw.is_edited !== undefined) allowed.is_edited = payloadRaw.is_edited;
  if (payloadRaw.isRevoked !== undefined) allowed.isRevoked = payloadRaw.isRevoked;
  if (payloadRaw.isEdited !== undefined) allowed.isEdited = payloadRaw.isEdited;
  if (payloadRaw.edited_at !== undefined) allowed.edited_at = payloadRaw.edited_at;
  if (payloadRaw.editedAt !== undefined) allowed.editedAt = payloadRaw.editedAt;

  // Audio/voice/ptt/video/document — hanya URL & mime, tanpa JID
  if (payloadRaw.audio && typeof payloadRaw.audio === 'object') allowed.audio = { url: (payloadRaw.audio as any).url };
  if (payloadRaw.voice && typeof payloadRaw.voice === 'object') allowed.voice = { url: (payloadRaw.voice as any).url };
  if (payloadRaw.ptt && typeof payloadRaw.ptt === 'object') allowed.ptt = { url: (payloadRaw.ptt as any).url };
  if (payloadRaw.video && typeof payloadRaw.video === 'object') {
    const v: any = payloadRaw.video;
    allowed.video = { url: v.url, caption: v.caption ? maskPhoneInText(String(v.caption)) : v.caption, mimeType: v.mimeType };
    Object.keys(allowed.video).forEach((k) => (allowed.video as any)[k] === undefined && delete (allowed.video as any)[k]);
  }
  if (payloadRaw.document && typeof payloadRaw.document === 'object') {
    const d: any = payloadRaw.document;
    allowed.document = { url: d.url, fileName: d.fileName ? maskPhoneInText(String(d.fileName)) : d.fileName, mimeType: d.mimeType, fileSize: d.fileSize };
    Object.keys(allowed.document).forEach((k) => (allowed.document as any)[k] === undefined && delete (allowed.document as any)[k]);
  }
  // Caption top-level
  if (typeof payloadRaw.caption === 'string') allowed.caption = maskPhoneInText(payloadRaw.caption);

  // Reactions — strip actorId yang mengandung @
  if (Array.isArray(payloadRaw.reactions)) {
    allowed.reactions = (payloadRaw.reactions as any[]).map((r: any) => {
      if (!r || typeof r !== 'object') return null;
      const fr: any = { emoji: r.emoji };
      if (r.fromMe !== undefined) fr.fromMe = r.fromMe;
      if (r.senderName) fr.senderName = maskPhoneInText(String(r.senderName));
      if (r.createdAt) fr.createdAt = r.createdAt;
      if (r.created_at) fr.created_at = r.created_at;
      return fr;
    }).filter(Boolean);
  }

  return allowed;
}

/**
 * sanitizeMessageForStaff — sanitasi satu row message DB untuk response terapis.
 * - content, sender_name, media.caption, contact, location, quoted_message di-mask
 * - payload_raw di-filter via allowlist sanitizePayloadRawForStaff
 */
export function sanitizeMessageForStaff(msg: any): any {
  if (!msg || typeof msg !== 'object') return msg;
  const clone: any = { ...msg };

  if (typeof clone.content === 'string' && clone.content) {
    clone.content = maskPhoneInText(clone.content);
  }
  if (typeof clone.sender_name === 'string' && clone.sender_name) {
    clone.sender_name = maskPhoneInText(clone.sender_name);
  }
  if (typeof clone.senderName === 'string' && clone.senderName) {
    clone.senderName = maskPhoneInText(clone.senderName);
  }

  if (clone.media && typeof clone.media === 'object' && !Array.isArray(clone.media)) {
    const m = { ...clone.media };
    if (typeof m.caption === 'string' && m.caption) m.caption = maskPhoneInText(m.caption);
    if (typeof m.fileName === 'string' && m.fileName) m.fileName = maskPhoneInText(m.fileName);
    clone.media = m;
  }

  if (clone.contact && typeof clone.contact === 'object' && !Array.isArray(clone.contact)) {
    const c = { ...clone.contact };
    if (c.phone) c.phone = maskPhoneInText(String(c.phone));
    if (c.phoneNumber) c.phoneNumber = maskPhoneInText(String(c.phoneNumber));
    if (c.phone_number) c.phone_number = maskPhoneInText(String(c.phone_number));
    clone.contact = c;
  }

  if (clone.location && typeof clone.location === 'object' && !Array.isArray(clone.location)) {
    const l = { ...clone.location };
    if (typeof l.address === 'string' && l.address) l.address = maskPhoneInText(l.address);
    if (typeof l.name === 'string' && l.name) l.name = maskPhoneInText(l.name);
    clone.location = l;
  }

  // quoted_message di top-level (bukan payload_raw)
  const qTop = clone.quoted_message || (clone as any).quotedMessage;
  if (qTop && typeof qTop === 'object' && !Array.isArray(qTop)) {
    const q = { ...qTop };
    if (typeof q.content === 'string' && q.content) q.content = maskPhoneInText(q.content);
    if (typeof q.text === 'string' && q.text) q.text = maskPhoneInText(q.text);
    if (typeof q.caption === 'string' && q.caption) q.caption = maskPhoneInText(q.caption);
    if (typeof q.sender_name === 'string' && q.sender_name) q.sender_name = maskPhoneInText(q.sender_name);
    if (typeof q.senderName === 'string' && q.senderName) q.senderName = maskPhoneInText(q.senderName);
    if (q.media && typeof q.media === 'object' && typeof q.media.caption === 'string') {
      q.media = { ...q.media, caption: maskPhoneInText(q.media.caption) };
    }
    clone.quoted_message = q;
    if ((clone as any).quotedMessage) (clone as any).quotedMessage = q;
  }

  // payload_raw / payloadRaw — filter allowlist
  if (clone.payload_raw && typeof clone.payload_raw === 'object' && !Array.isArray(clone.payload_raw)) {
    clone.payload_raw = sanitizePayloadRawForStaff(clone.payload_raw);
  }
  if ((clone as any).payloadRaw && typeof (clone as any).payloadRaw === 'object' && !Array.isArray((clone as any).payloadRaw)) {
    (clone as any).payloadRaw = sanitizePayloadRawForStaff((clone as any).payloadRaw);
  }
  // snake_case alias payloadRaw di beberapa path
  if ((clone as any).payload_raw !== undefined && clone.payload_raw === undefined) {
    // sudah handled
  }

  return clone;
}

/**
 * sanitizeStaffHubPayload — sanitasi payload event LiveChatHub sebelum SSE ke terapis.
 * Menangani dua bentuk payload: message.created (berisi content/media/location/contact)
 * dan message.updated (berisi content parsial + messageId/waMessageId yang bisa mengandung JID).
 */
export function sanitizeStaffHubPayload(payload: any, eventType?: string): any {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const clone: any = { ...payload };

  // Common: message.created atau payload yang membawa content
  if (eventType === 'message.created' || eventType === 'message.updated' || clone.content !== undefined || clone.senderName !== undefined) {
    if (typeof clone.content === 'string' && clone.content) clone.content = maskPhoneInText(clone.content);
    if (typeof clone.senderName === 'string' && clone.senderName) clone.senderName = maskPhoneInText(clone.senderName);
    if (typeof clone.sender_name === 'string' && clone.sender_name) clone.sender_name = maskPhoneInText(clone.sender_name);
    if (typeof clone.messageId === 'string' && clone.messageId) clone.messageId = maskPhoneInText(clone.messageId);
    if (typeof clone.waMessageId === 'string' && clone.waMessageId) clone.waMessageId = maskPhoneInText(clone.waMessageId);
    if (typeof clone.wa_message_id === 'string' && clone.wa_message_id) clone.wa_message_id = maskPhoneInText(clone.wa_message_id);
    if (typeof clone.id === 'string' && clone.id.includes('@')) clone.id = maskPhoneInText(clone.id);

    if (clone.media && typeof clone.media === 'object' && typeof clone.media.caption === 'string') {
      clone.media = { ...clone.media, caption: maskPhoneInText(clone.media.caption) };
    }
    if (clone.contact && typeof clone.contact === 'object') {
      const c = { ...clone.contact };
      if (c.phone) c.phone = maskPhoneInText(String(c.phone));
      if (c.phoneNumber) c.phoneNumber = maskPhoneInText(String(c.phoneNumber));
      clone.contact = c;
    }
    if (clone.location && typeof clone.location === 'object') {
      const l = { ...clone.location };
      if (typeof l.address === 'string') l.address = maskPhoneInText(l.address);
      if (typeof l.name === 'string') l.name = maskPhoneInText(l.name);
      clone.location = l;
    }
    const qHub = clone.quoted_message || clone.quotedMessage;
    if (qHub && typeof qHub === 'object') {
      const q = { ...qHub };
      if (typeof q.content === 'string') q.content = maskPhoneInText(q.content);
      if (typeof q.text === 'string') q.text = maskPhoneInText(q.text);
      if (typeof q.sender_name === 'string') q.sender_name = maskPhoneInText(q.sender_name);
      if (typeof q.senderName === 'string') q.senderName = maskPhoneInText(q.senderName);
      clone.quoted_message = q;
      if (clone.quotedMessage) clone.quotedMessage = q;
    }
    if (clone.payloadRaw && typeof clone.payloadRaw === 'object') clone.payloadRaw = sanitizePayloadRawForStaff(clone.payloadRaw);
    if (clone.payload_raw && typeof clone.payload_raw === 'object') clone.payload_raw = sanitizePayloadRawForStaff(clone.payload_raw);
    if (clone.payload && typeof clone.payload === 'object' && clone.payloadRaw === undefined && clone.payload_raw === undefined) {
      // fallback: jika payload membawa nested payload
      clone.payload = sanitizePayloadRawForStaff(clone.payload);
    }
  }

  // message.updated sering membawa conversationId + content parsial — content sudah di-mask di atas
  // conversation.updated tidak mengandung PII chat, tidak perlu maskir tambahan

  return clone;
}

export function maskAddress(address?: string | null): string {
  if (!address || typeof address !== 'string') return '';
  // Sensor angka nomor rumah, blok, RT/RW
  return address
    .replace(/\b(no\.?\s*\d+|rt\s*\d+|rw\s*\d+|blok\s*[a-z0-9]+)\b/gi, '***')
    .replace(/\b(\d{1,4})\b/g, '***');
}

export function maskToolArgsForLogging(toolName: string, args: Record<string, any>): Record<string, any> {
  if (!args || typeof args !== 'object') return {};
  const masked = { ...args };

  if (masked.streetDetail) masked.streetDetail = maskAddress(masked.streetDetail);
  if (masked.locationText) masked.locationText = maskAddress(masked.locationText);
  if (masked.customerName) masked.customerName = `${String(masked.customerName).slice(0, 2)}***`;
  if (masked.childName) masked.childName = `${String(masked.childName).slice(0, 1)}***`;
  if (masked.phone) masked.phone = maskPhoneNumber(masked.phone);
  if (masked.notes) masked.notes = '[CATATAN DISENSOR]';
  if (masked.children && Array.isArray(masked.children)) {
    masked.children = masked.children.map((c: any) => ({
      ...c,
      name: c.name ? `${String(c.name).slice(0, 1)}***` : undefined,
    }));
  }

  return masked;
}
