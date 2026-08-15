import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

/**
 * Meng-hash plaintext password menggunakan bcrypt dengan salt 12 rounds.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Memvalidasi plaintext password terhadap hash bcrypt.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
