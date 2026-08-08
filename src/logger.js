import path from 'node:path';
import pino from 'pino';
import { config } from '../config/config.js';

export function criarLogger() {
  const transport = pino.transport({
    targets: [
      { target: 'pino/file', level: config.logLevel, options: { destination: 1 } },
      {
        target: 'pino-roll',
        level: config.logLevel,
        options: {
          file: path.join(config.pastas.logs, 'q-zap'),
          frequency: 'daily',
          dateFormat: 'yyyy-MM-dd',
          extension: '.log',
          mkdir: true,
        },
      },
    ],
  });

  return pino(transport);
}
