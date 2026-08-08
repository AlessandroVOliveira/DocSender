import { garantirEstruturaDePastas } from '../src/bootstrap.js';
import { config } from '../config/config.js';

const logger = {
  debug: () => {},
  info: (dados, mensagem) => console.log(mensagem, dados?.pasta ?? ''),
};

await garantirEstruturaDePastas(logger);
console.log(`Estrutura de pastas garantida em ${config.pastas.base}`);
