import path from 'node:path';
import { rename, writeFile } from 'node:fs/promises';
import { config } from '../config/config.js';

export async function salvarEmEnviados(nomeArquivo, pdfBytes) {
  await writeFile(path.join(config.pastas.enviados, nomeArquivo), pdfBytes);
}

export async function salvarEmErro(nomeArquivo, pdfBytes) {
  await writeFile(path.join(config.pastas.erro, nomeArquivo), pdfBytes);
}

export async function moverParaProcessado(caminhoArquivoOrigem) {
  const destino = path.join(config.pastas.processado, path.basename(caminhoArquivoOrigem));
  await rename(caminhoArquivoOrigem, destino);
}
