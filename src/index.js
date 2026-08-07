import pino from 'pino';
import { config } from '../config/config.js';
import { garantirEstruturaDePastas } from './bootstrap.js';
import { aguardarConexao } from './evolutionClient.js';
import { criarFila } from './fila.js';
import { iniciarWatcher } from './watcher.js';

const logger = pino({ level: config.logLevel });

async function processarItemDaFila(item) {
  logger.info(
    { tipo: item.tipo, numero: item.numero, nome: item.nome, paginas: item.paginas, arquivoOrigem: item.arquivoOrigem },
    'item retirado da fila',
  );
}

async function main() {
  await garantirEstruturaDePastas(logger);
  await aguardarConexao({ logger });
  const fila = criarFila(processarItemDaFila);
  iniciarWatcher({ logger, fila });
  logger.info({ pastaBase: config.pastas.base }, 'Q-Zap iniciado');
}

main().catch((erro) => {
  logger.fatal({ erro }, 'falha ao iniciar Q-Zap');
  process.exit(1);
});
