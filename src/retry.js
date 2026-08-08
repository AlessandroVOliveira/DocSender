import { config } from '../config/config.js';

export function calcularBackoffMs(tentativa) {
  const { baseMs, maxMs } = config.retry;
  const duracaoBase = Math.min(baseMs * 2 ** (tentativa - 1), maxMs);
  const jitter = Math.random() * 500;
  return duracaoBase + jitter;
}
