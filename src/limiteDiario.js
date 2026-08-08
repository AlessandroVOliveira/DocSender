import path from 'node:path';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { config } from '../config/config.js';

function caminhoArquivo() {
  return path.join(config.pastas.logs, 'contagem-diaria.json');
}

function dataDeHoje() {
  return new Date().toISOString().slice(0, 10);
}

async function lerEstado() {
  try {
    const conteudo = await readFile(caminhoArquivo(), 'utf-8');
    const estado = JSON.parse(conteudo);
    if (estado.data !== dataDeHoje()) {
      return { data: dataDeHoje(), contagens: {} };
    }
    return estado;
  } catch (erro) {
    if (erro.code === 'ENOENT') {
      return { data: dataDeHoje(), contagens: {} };
    }
    throw erro;
  }
}

async function gravarEstado(estado) {
  const destino = caminhoArquivo();
  const temporario = `${destino}.tmp`;
  await writeFile(temporario, JSON.stringify(estado, null, 2));
  await rename(temporario, destino);
}

export async function atingiuLimite(numero) {
  const estado = await lerEstado();
  return (estado.contagens[numero] || 0) >= config.limiteDiarioPorNumero;
}

export async function registrarEnvio(numero) {
  const estado = await lerEstado();
  estado.contagens[numero] = (estado.contagens[numero] || 0) + 1;
  await gravarEstado(estado);
}
