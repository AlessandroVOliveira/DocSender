import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CAMINHO_TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'template.txt');

export async function carregarTemplate() {
  return readFile(CAMINHO_TEMPLATE, 'utf-8');
}

export function montarMensagem(template, nome) {
  return template.replaceAll('{nome}', nome);
}
