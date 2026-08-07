import { mkdir } from 'node:fs/promises';
import { config } from '../config/config.js';

export async function garantirEstruturaDePastas(logger) {
  const pastas = Object.values(config.pastas);
  for (const pasta of pastas) {
    await mkdir(pasta, { recursive: true });
    logger.debug({ pasta }, 'pasta garantida');
  }
}
