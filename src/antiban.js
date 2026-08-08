import { config } from '../config/config.js';

export function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function calcularDelayMs() {
  const { minSec, maxSec } = config.delay;
  const minMs = minSec * 1000;
  const maxMs = maxSec * 1000;
  return minMs + Math.random() * (maxMs - minMs);
}

export function calcularDuracaoDigitandoMs(tamanhoMensagem) {
  const { baseMs, msPorCaracter, maxMs } = config.digitando;
  const duracaoBase = Math.min(baseMs + tamanhoMensagem * msPorCaracter, maxMs);
  const jitter = Math.random() * 500;
  return duracaoBase + jitter;
}
