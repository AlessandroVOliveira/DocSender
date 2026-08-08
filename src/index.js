import { pathToFileURL } from 'node:url';
import pino from 'pino';
import { config } from '../config/config.js';
import { garantirEstruturaDePastas } from './bootstrap.js';
import { salvarEmEnviados, salvarEmErro, moverParaProcessado } from './armazenamento.js';
import { aguardarConexao, enviarDocumento } from './evolutionClient.js';
import { criarFila } from './fila.js';
import { criarRastreadorArquivos } from './rastreadorArquivos.js';
import { carregarTemplate, montarMensagem } from './template.js';
import { iniciarWatcher } from './watcher.js';

const logger = pino({ level: config.logLevel });

async function processarDocumento(item) {
  const template = await carregarTemplate();
  const mensagem = montarMensagem(template, item.nome);

  try {
    await enviarDocumento(item.numero, {
      pdfBytes: item.pdfBytes,
      nomeArquivo: item.nomeArquivoSalvo,
      legenda: mensagem,
    });
    await salvarEmEnviados(item.nomeArquivoSalvo, item.pdfBytes);
    logger.info(
      { arquivoOrigem: item.arquivoOrigem, numero: item.numero, nome: item.nome },
      'documento enviado',
    );
  } catch (erro) {
    await salvarEmErro(item.nomeArquivoSalvo, item.pdfBytes);
    logger.error(
      { arquivoOrigem: item.arquivoOrigem, numero: item.numero, erro: erro.message },
      'falha ao enviar documento, movido para erro',
    );
  }
}

async function processarErro(item) {
  await salvarEmErro(item.nomeArquivoSalvo, item.pdfBytes);
  logger.warn(
    { arquivoOrigem: item.arquivoOrigem, paginas: item.paginas, motivo: item.motivo },
    'documento movido para erro',
  );
}

export function criarProcessadorDeItens(rastreador) {
  return async function processarItemDaFila(item) {
    if (item.tipo === 'documento') {
      await processarDocumento(item);
    } else {
      await processarErro(item);
    }

    if (rastreador.concluirItem(item.arquivoOrigem)) {
      await moverParaProcessado(item.arquivoOrigem);
      logger.info({ arquivoOrigem: item.arquivoOrigem }, 'arquivo de entrada totalmente processado');
    }
  };
}

async function main() {
  await garantirEstruturaDePastas(logger);
  await aguardarConexao({ logger });

  const rastreador = criarRastreadorArquivos();
  const fila = criarFila(criarProcessadorDeItens(rastreador));
  iniciarWatcher({ logger, fila, rastreador });

  logger.info({ pastaBase: config.pastas.base }, 'Q-Zap iniciado');
}

const executadoDiretamente = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDiretamente) {
  main().catch((erro) => {
    logger.fatal({ erro }, 'falha ao iniciar Q-Zap');
    process.exit(1);
  });
}
