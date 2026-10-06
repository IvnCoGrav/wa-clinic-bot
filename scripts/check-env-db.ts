import fs from 'fs';
import dotenv from 'dotenv';

const env = dotenv.parse(fs.readFileSync('.env', 'utf8'));
const dbUrl = env.DATABASE_URL || '';
if (dbUrl) {
  try {
    const u = new URL(dbUrl);
    console.log('DATABASE_URL protocol:', u.protocol);
    console.log('DATABASE_URL host:', u.hostname);
    console.log('DATABASE_URL port:', u.port);
    console.log('DATABASE_URL pathname:', u.pathname);
  } catch (err: any) {
    console.log('Failed to parse URL:', err.message);
  }
} else {
  console.log('No DATABASE_URL in .env');
}
