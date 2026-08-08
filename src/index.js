import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { unlink } from 'node:fs/promises';
import { config } from '../config/config.js';
import { criarLogger } from './logger.js';
import { garantirEstruturaDePastas } from './bootstrap.js';
import { salvarEmEnviados, salvarEmErro, moverParaProcessado } from './armazenamento.js';
import { aguardarConexao, configurarWebhook, enviarDocumento, enviarPresenca, enviarTexto } from './evolutionClient.js';
import { calcularDelayMs, calcularDuracaoDigitandoMs, esperar } from './antiban.js';
import { atingiuLimite, registrarEnvio } from './limiteDiario.js';
import { calcularBackoffMs } from './retry.js';
import { criarCircuitBreaker } from './circuitBreaker.js';
import { criarContadorFalhasConsecutivas } from './contadorFalhasConsecutivas.js';
import { iniciarServidorWebhook } from './webhookServer.js';
import { criarFila } from './fila.js';
import { criarRastreadorArquivos } from './rastreadorArquivos.js';
import { carregarTemplate, montarMensagem } from './template.js';
import { iniciarWatcher } from './watcher.js';

const logger = criarLogger();

async function processarDocumento(item, { circuitBreaker, contadorFalhas }) {
  const template = await carregarTemplate();
  const mensagem = montarMensagem(template, item.nome);

  if (await atingiuLimite(item.numero)) {
    const motivo = 'limite diario de mensagens atingido para o numero';
    await salvarEmErro(item.nomeArquivoSalvo, item.pdfBytes, motivo);
    logger.warn(
      { arquivoOrigem: item.arquivoOrigem, numero: item.numero, nome: item.nome },
      'limite diario de mensagens atingido para o numero, documento movido para erro',
    );
    return { tipo: 'erro', identificacao: item.nomeArquivoSalvo, motivo };
  }

  await esperar(calcularDelayMs());

  let ultimoErro;
  for (let tentativa = 1; tentativa <= config.retry.maxTentativas; tentativa++) {
    try {
      const duracaoDigitando = calcularDuracaoDigitandoMs(mensagem.length);
      await enviarPresenca(item.numero, 'composing', duracaoDigitando);
      await esperar(duracaoDigitando);

      await enviarDocumento(item.numero, {
        pdfBytes: item.pdfBytes,
        nomeArquivo: item.nomeArquivoSalvo,
        legenda: mensagem,
      });
      await registrarEnvio(item.numero);
      await salvarEmEnviados(item.nomeArquivoSalvo, item.pdfBytes);
      contadorFalhas.registrarSucesso();
      logger.info(
        { arquivoOrigem: item.arquivoOrigem, numero: item.numero, nome: item.nome, tentativa },
        'documento enviado',
      );
      return { tipo: 'enviado', identificacao: item.nomeArquivoSalvo };
    } catch (erro) {
      ultimoErro = erro;
      logger.warn(
        { arquivoOrigem: item.arquivoOrigem, numero: item.numero, tentativa, erro: erro.message },
        'falha ao enviar documento, nova tentativa agendada',
      );
      if (tentativa < config.retry.maxTentativas) {
        await esperar(calcularBackoffMs(tentativa));
      }
    }
  }

  await salvarEmErro(item.nomeArquivoSalvo, item.pdfBytes, ultimoErro.message);
  logger.error(
    { arquivoOrigem: item.arquivoOrigem, numero: item.numero, erro: ultimoErro.message },
    'falha ao enviar documento apos esgotar tentativas, movido para erro',
  );

  const falhasConsecutivas = contadorFalhas.registrarFalha();
  if (falhasConsecutivas >= config.circuitBreaker.maxFalhasConsecutivas) {
    await circuitBreaker.pausar(
      `${falhasConsecutivas} falhas de envio consecutivas (ultimo erro: ${ultimoErro.message})`,
    );
  }

  return { tipo: 'erro', identificacao: item.nomeArquivoSalvo, motivo: ultimoErro.message };
}

async function processarErro(item) {
  await salvarEmErro(item.nomeArquivoSalvo, item.pdfBytes, item.motivo);
  logger.warn(
    { arquivoOrigem: item.arquivoOrigem, paginas: item.paginas, motivo: item.motivo },
    'documento movido para erro',
  );
  return { tipo: 'erro', identificacao: item.nomeArquivoSalvo, motivo: item.motivo };
}

function montarResumoDeArquivo(arquivoOrigem, resultados) {
  const enviados = resultados.filter((resultado) => resultado.tipo === 'enviado');
  const erros = resultados.filter((resultado) => resultado.tipo === 'erro');

  const linhas = [
    `Q-Zap: processamento concluido - ${path.basename(arquivoOrigem)}`,
    `Enviados: ${enviados.length}`,
    `Erros: ${erros.length}`,
  ];

  if (erros.length > 0) {
    linhas.push(...erros.map((erro) => `- ${erro.identificacao} - ${erro.motivo}`));
  }

  return linhas.join('\n');
}

async function enviarResumoDeArquivo(arquivoOrigem, resultados) {
  const mensagem = montarResumoDeArquivo(arquivoOrigem, resultados);
  await enviarTexto(config.numeroAdmin, mensagem).catch((erro) => {
    logger.error(
      { arquivoOrigem, erro: erro.message },
      'falha ao enviar resumo de processamento ao numero administrador',
    );
  });
}

export function criarProcessadorDeItens(rastreador, deps = {}) {
  const circuitBreaker = deps.circuitBreaker ?? criarCircuitBreaker({ logger });
  const contadorFalhas = deps.contadorFalhas ?? criarContadorFalhasConsecutivas();

  return async function processarItemDaFila(item) {
    let resultado;
    if (item.tipo === 'documento') {
      await circuitBreaker.aguardarSeAtivo();
      resultado = await processarDocumento(item, { circuitBreaker, contadorFalhas });
    } else {
      resultado = await processarErro(item);
    }

    rastreador.registrarResultado(item.arquivoOrigem, resultado);

    if (rastreador.concluirItem(item.arquivoOrigem)) {
      await moverParaProcessado(item.arquivoOrigem);
      logger.info({ arquivoOrigem: item.arquivoOrigem }, 'arquivo de entrada totalmente processado');
      await enviarResumoDeArquivo(item.arquivoOrigem, rastreador.obterResultados(item.arquivoOrigem));
    }
  };
}

function formatarDuracao(duracaoMs) {
  const totalSegundos = Math.round(duracaoMs / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${minutos}min ${segundos}s`;
}

export async function tratarRetomada({ circuitBreaker }) {
  const caminhoRetomar = path.join(config.pastas.base, 'RETOMAR.txt');
  await unlink(caminhoRetomar).catch((erro) => {
    if (erro.code !== 'ENOENT') throw erro;
  });

  const resumo = await circuitBreaker.retomar();
  if (!resumo) return;

  const mensagem = [
    'Q-Zap: processamento retomado.',
    `Motivo da pausa: ${resumo.motivo}`,
    `Pausado desde: ${resumo.desde.toLocaleString('pt-BR')}`,
    `Retomado em: ${resumo.ate.toLocaleString('pt-BR')}`,
    `Duracao da pausa: ${formatarDuracao(resumo.ate - resumo.desde)}`,
  ].join('\n');

  await enviarTexto(config.numeroAdmin, mensagem).catch((erro) => {
    logger.error({ erro: erro.message }, 'falha ao enviar resumo retroativo da pausa ao numero administrador');
  });
}

async function main() {
  await garantirEstruturaDePastas(logger);
  await aguardarConexao({ logger });

  const circuitBreaker = criarCircuitBreaker({ logger });
  const contadorFalhas = criarContadorFalhasConsecutivas();

  iniciarServidorWebhook({
    logger,
    onStatusConexao: (estado) => {
      logger.info({ estado }, 'evento de status de conexao recebido via webhook');
      if (estado === 'close') {
        circuitBreaker
          .pausar('Evolution API desconectada (webhook connection.update: close)')
          .catch((erro) => logger.error({ erro: erro.message }, 'falha ao registrar pausa por circuit breaker'));
      }
    },
  });

  const urlWebhook = `http://127.0.0.1:${config.webhookPort}/webhook`;
  await configurarWebhook(urlWebhook);
  logger.info({ urlWebhook }, 'webhook de status de conexao configurado na Evolution API');

  const rastreador = criarRastreadorArquivos();
  const fila = criarFila(criarProcessadorDeItens(rastreador, { circuitBreaker, contadorFalhas }));
  iniciarWatcher({
    logger,
    fila,
    rastreador,
    onRetomar: () => tratarRetomada({ circuitBreaker }),
  });

  logger.info({ pastaBase: config.pastas.base }, 'Q-Zap iniciado');
}

const executadoDiretamente = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDiretamente) {
  main().catch((erro) => {
    logger.fatal({ erro }, 'falha ao iniciar Q-Zap');
    process.exit(1);
  });
}
