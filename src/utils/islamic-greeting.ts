/**
 * Islamic Greeting Detector & Formatter
 */
export function hasIslamicGreeting(text: string): boolean {
  if (!text) return false;
  return /\b(assalamu'?alaikum|assalamualaikum|asslm|askum|ass\b|samlikum)\b/i.test(text);
}

export function formatIslamicReply(text: string): string {
  return `Waalaikumsalam Bunda! ✨\n\n${text}`;
}
