import path from 'node:path';
import { appendFile, rename, writeFile } from 'node:fs/promises';
import { config } from '../config/config.js';

export async function salvarEmEnviados(nomeArquivo, pdfBytes) {
  await writeFile(path.join(config.pastas.enviados, nomeArquivo), pdfBytes);
}

export async function salvarEmErro(nomeArquivo, pdfBytes, motivo) {
  await writeFile(path.join(config.pastas.erro, nomeArquivo), pdfBytes);
  await appendFile(path.join(config.pastas.erro, 'log.txt'), `${nomeArquivo} - ${motivo}\n`);
}

export async function moverParaProcessado(caminhoArquivoOrigem) {
  const destino = path.join(config.pastas.processado, path.basename(caminhoArquivoOrigem));
  await rename(caminhoArquivoOrigem, destino);
}
