import pino from 'pino';
import { config } from '../config/config.js';
import { garantirEstruturaDePastas } from './bootstrap.js';

const logger = pino({ level: config.logLevel });

async function main() {
  await garantirEstruturaDePastas(logger);
  logger.info({ pastaBase: config.pastas.base }, 'Q-Zap iniciado');
}

main().catch((erro) => {
  logger.fatal({ erro }, 'falha ao iniciar Q-Zap');
  process.exit(1);
});
