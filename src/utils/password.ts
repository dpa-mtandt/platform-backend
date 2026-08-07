import bcrypt from 'bcryptjs';
import { config } from '../config/env';

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.bcryptSaltRounds);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
