import path from 'node:path';
import { readFile } from 'node:fs/promises';
import chokidar from 'chokidar';
import { config } from '../config/config.js';
import { processarArquivoPdf } from './processarPdf.js';

export function iniciarWatcher({ logger, fila, rastreador }) {
  const watcher = chokidar.watch(config.pastas.entrada, {
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 2000,
      pollInterval: 200,
    },
  });

  watcher.on('add', async (caminhoArquivo) => {
    if (path.extname(caminhoArquivo).toLowerCase() !== '.pdf') {
      logger.warn({ caminhoArquivo }, 'arquivo ignorado: v1 aceita apenas .pdf');
      return;
    }

    logger.info({ caminhoArquivo }, 'novo arquivo estavel detectado');

    try {
      const dadosPdf = await readFile(caminhoArquivo);
      const { documentos, erros } = await processarArquivoPdf(new Uint8Array(dadosPdf));
      const baseNome = path.parse(caminhoArquivo).name;

      rastreador.registrarTotal(caminhoArquivo, documentos.length + erros.length);

      documentos.forEach((documento, indice) => {
        const nomeArquivoSalvo = `${baseNome}__doc${indice + 1}__${documento.numero}.pdf`;
        fila.adicionar({ tipo: 'documento', arquivoOrigem: caminhoArquivo, nomeArquivoSalvo, ...documento });
      });
      erros.forEach((erro, indice) => {
        const nomeArquivoSalvo = `${baseNome}__erro${indice + 1}__p${erro.paginas[0]}.pdf`;
        fila.adicionar({ tipo: 'erro', arquivoOrigem: caminhoArquivo, nomeArquivoSalvo, ...erro });
      });

      logger.info(
        { caminhoArquivo, documentos: documentos.length, erros: erros.length },
        'arquivo dividido e enfileirado',
      );
    } catch (erro) {
      logger.error({ caminhoArquivo, erro }, 'falha ao processar arquivo de entrada');
    }
  });

  watcher.on('error', (erro) => {
    logger.error({ erro }, 'erro no watcher da pasta de entrada');
  });

  return watcher;
}
