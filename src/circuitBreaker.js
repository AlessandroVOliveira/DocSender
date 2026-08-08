import path from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { config } from '../config/config.js';

function caminhoStatus() {
  return path.join(config.pastas.base, 'status.txt');
}

export function criarCircuitBreaker({ logger }) {
  let pausada = false;
  let motivo = null;
  let desde = null;
  let aguardando = [];

  async function pausar(motivoPausa) {
    if (pausada) return;
    pausada = true;
    motivo = motivoPausa;
    desde = new Date();
    await writeFile(caminhoStatus(), `Fila pausada em ${desde.toISOString()}\nMotivo: ${motivo}\n`);
    logger.error({ motivo, desde: desde.toISOString() }, 'fila pausada por circuit breaker');
  }

  async function retomar() {
    if (!pausada) return null;
    const resumo = { motivo, desde, ate: new Date() };
    pausada = false;
    motivo = null;
    desde = null;
    await unlink(caminhoStatus()).catch((erro) => {
      if (erro.code !== 'ENOENT') throw erro;
    });
    logger.info({ motivo: resumo.motivo, desde: resumo.desde.toISOString(), ate: resumo.ate.toISOString() }, 'fila retomada apos pausa por circuit breaker');
    const pendentes = aguardando;
    aguardando = [];
    pendentes.forEach((resolve) => resolve());
    return resumo;
  }

  function estaPausada() {
    return pausada;
  }

  function aguardarSeAtivo() {
    if (!pausada) return Promise.resolve();
    return new Promise((resolve) => aguardando.push(resolve));
  }

  return { pausar, retomar, estaPausada, aguardarSeAtivo };
}
