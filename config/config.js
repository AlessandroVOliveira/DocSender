import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const REQUIRED_VARS = ['PASTA_BASE', 'NUMERO_ADMIN', 'EVOLUTION_API_KEY', 'LIMITE_DIARIO_POR_NUMERO'];

function requireEnv() {
  const faltando = REQUIRED_VARS.filter((nome) => !process.env[nome]);
  if (faltando.length > 0) {
    throw new Error(`Variaveis obrigatorias ausentes no .env: ${faltando.join(', ')}`);
  }
}

requireEnv();

const pastaBase = process.env.PASTA_BASE;

export const config = {
  pastas: {
    base: pastaBase,
    entrada: path.join(pastaBase, 'entrada'),
    enviados: path.join(pastaBase, 'enviados'),
    erro: path.join(pastaBase, 'erro'),
    processado: path.join(pastaBase, 'processado'),
    logs: path.join(pastaBase, 'logs'),
  },
  evolution: {
    url: process.env.EVOLUTION_API_URL || 'http://localhost:8080',
    apiKey: process.env.EVOLUTION_API_KEY,
    instancia: process.env.EVOLUTION_INSTANCE || 'Q-Zap',
  },
  webhookPort: Number(process.env.WEBHOOK_PORT || 3939),
  numeroAdmin: process.env.NUMERO_ADMIN,
  delay: {
    minSec: Number(process.env.DELAY_MIN_SEC || 5),
    maxSec: Number(process.env.DELAY_MAX_SEC || 15),
  },
  digitando: {
    baseMs: Number(process.env.TYPING_BASE_MS || 1500),
    msPorCaracter: Number(process.env.TYPING_MS_POR_CARACTER || 40),
    maxMs: Number(process.env.TYPING_MAX_MS || 8000),
  },
  limiteDiarioPorNumero: Number(process.env.LIMITE_DIARIO_POR_NUMERO),
  retry: {
    maxTentativas: Number(process.env.RETRY_MAX_TENTATIVAS || 3),
    baseMs: Number(process.env.RETRY_BASE_MS || 5000),
    maxMs: Number(process.env.RETRY_MAX_MS || 60000),
  },
  circuitBreaker: {
    maxFalhasConsecutivas: Number(process.env.CIRCUIT_BREAKER_MAX_FALHAS_CONSECUTIVAS || 3),
  },
  logLevel: process.env.LOG_LEVEL || 'info',
};
