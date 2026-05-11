// 32-char alphabet: A-Z minus O, 2-9 (removes 0, 1, ambiguous chars)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateEventCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]!).join('');
}
