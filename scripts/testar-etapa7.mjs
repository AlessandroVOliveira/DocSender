import { execSync } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import axios from 'axios';
import pino from 'pino';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { config } from '../config/config.js';
import { criarProcessadorDeItens, tratarRetomada } from '../src/index.js';
import { criarFila } from '../src/fila.js';
import { criarRastreadorArquivos } from '../src/rastreadorArquivos.js';
import { iniciarWatcher } from '../src/watcher.js';
import { iniciarServidorWebhook } from '../src/webhookServer.js';
import { criarCircuitBreaker } from '../src/circuitBreaker.js';
import { criarContadorFalhasConsecutivas } from '../src/contadorFalhasConsecutivas.js';
import { calcularBackoffMs } from '../src/retry.js';
import { aguardarConexao, configurarWebhook } from '../src/evolutionClient.js';

const logger = pino({ level: 'info' });

function assert(condicao, mensagem) {
  if (!condicao) {
    throw new Error(`falha: ${mensagem}`);
  }
}

async function assertArquivoNaoExiste(caminho) {
  try {
    await readFile(caminho);
    throw new Error(`esperava que ${caminho} nao existisse`);
  } catch (erro) {
    if (erro.code !== 'ENOENT') throw erro;
  }
}

async function gerarPdfSintetico(paginas) {
  const doc = await PDFDocument.create();
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  for (const linhas of paginas) {
    const pagina = doc.addPage();
    linhas.forEach((linha, indice) => {
      pagina.drawText(linha, { x: 50, y: 750 - indice * 20, size: 12, font: fonte });
    });
  }
  return doc.save();
}

async function limparPastas() {
  for (const pasta of [config.pastas.entrada, config.pastas.enviados, config.pastas.erro, config.pastas.processado]) {
    const arquivos = await readdir(pasta);
    await Promise.all(
      arquivos
        .filter((arquivo) => arquivo.toLowerCase().startsWith('etapa7-'))
        .map((arquivo) => rm(path.join(pasta, arquivo))),
    );
  }
}

async function aguardarArquivosEm(pasta, prefixo, quantidadeEsperada, timeoutMs) {
  const inicio = Date.now();
  while (true) {
    const arquivos = (await readdir(pasta)).filter((arquivo) => arquivo.startsWith(prefixo));
    if (arquivos.length >= quantidadeEsperada) {
      return arquivos;
    }
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`timeout esperando ${quantidadeEsperada} arquivo(s) em ${pasta}, encontrados: ${arquivos.length}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function testarConfigurarWebhook() {
  console.log('\n=== configurarWebhook: registra a URL do webhook na Evolution API ===');
  await aguardarConexao({ logger });
  const urlWebhook = `http://127.0.0.1:${config.webhookPort}/webhook`;
  const resposta = await configurarWebhook(urlWebhook);
  assert(resposta.url === urlWebhook, `webhook registrado com url inesperada: ${JSON.stringify(resposta)}`);
  assert(resposta.enabled === true, 'webhook deveria estar habilitado apos configurarWebhook');
  assert(resposta.events.includes('CONNECTION_UPDATE'), 'webhook deveria escutar o evento CONNECTION_UPDATE');
  console.log('ok: webhook registrado na Evolution API apontando para', urlWebhook);
}

async function testarBackoff() {
  console.log('\n=== calcularBackoffMs: formula e clamp ===');
  const { baseMs, maxMs } = config.retry;
  for (let tentativa = 1; tentativa <= 6; tentativa++) {
    const valor = calcularBackoffMs(tentativa);
    const esperadoBase = Math.min(baseMs * 2 ** (tentativa - 1), maxMs);
    assert(
      valor >= esperadoBase && valor < esperadoBase + 500,
      `tentativa ${tentativa}: ${valor}ms fora do esperado ~${esperadoBase}ms + jitter`,
    );
  }
  console.log('ok: backoff cresce exponencialmente e satura em RETRY_MAX_MS');
}

async function testarContadorFalhas() {
  console.log('\n=== contadorFalhasConsecutivas ===');
  const contador = criarContadorFalhasConsecutivas();
  assert(contador.registrarFalha() === 1, 'primeira falha deveria contar 1');
  assert(contador.registrarFalha() === 2, 'segunda falha consecutiva deveria contar 2');
  contador.registrarSucesso();
  assert(contador.registrarFalha() === 1, 'apos sucesso, contagem deveria resetar para 1 na proxima falha');
  console.log('ok: contador incrementa em falhas consecutivas e reseta em sucesso');
}

async function testarCircuitBreakerIsolado() {
  console.log('\n=== circuitBreaker: pausar/retomar/aguardarSeAtivo + status.txt ===');
  const cb = criarCircuitBreaker({ logger });
  assert(cb.estaPausada() === false, 'nao deveria comecar pausado');

  await cb.pausar('teste isolado');
  assert(cb.estaPausada() === true, 'deveria estar pausado apos pausar()');

  const statusPath = path.join(config.pastas.base, 'status.txt');
  const conteudoStatus = await readFile(statusPath, 'utf-8');
  assert(conteudoStatus.includes('teste isolado'), 'status.txt deveria conter o motivo da pausa');

  let liberou = false;
  const espera = cb.aguardarSeAtivo().then(() => {
    liberou = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(liberou === false, 'aguardarSeAtivo nao deveria resolver enquanto pausado');

  const resumo = await cb.retomar();
  await espera;
  assert(liberou === true, 'aguardarSeAtivo deveria resolver apos retomar()');
  assert(cb.estaPausada() === false, 'nao deveria estar pausado apos retomar()');
  assert(resumo.motivo === 'teste isolado', 'resumo deveria conter o motivo original da pausa');

  await assertArquivoNaoExiste(statusPath);
  console.log('ok: pausar/retomar/aguardarSeAtivo e status.txt funcionam corretamente');
}

async function testarWebhookAcionaPausa() {
  console.log('\n=== webhookServer: evento connection.update (state=close) aciona pausa ===');
  const cb = criarCircuitBreaker({ logger });
  const servidor = iniciarServidorWebhook({
    logger,
    onStatusConexao: (estado) => {
      if (estado === 'close') {
        cb.pausar('teste: webhook connection.update close').catch(() => {});
      }
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 200));

  await axios.post(`http://127.0.0.1:${config.webhookPort}/webhook`, {
    event: 'connection.update',
    data: { state: 'close' },
  });

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(cb.estaPausada() === true, 'circuitBreaker deveria estar pausado apos evento close recebido via webhook');

  await cb.retomar();
  await new Promise((resolve, reject) => servidor.close((erro) => (erro ? reject(erro) : resolve())));
  console.log('ok: evento close recebido via HTTP no servidor local aciona a pausa corretamente');
}

async function testarBloqueioDuranteAPausa() {
  console.log('\n=== fila: item tipo documento aguarda circuitBreaker antes de enviar ===');
  await limparPastas();

  const cb = criarCircuitBreaker({ logger });
  const contador = criarContadorFalhasConsecutivas();
  await cb.pausar('teste: bloqueio de envio');

  const rastreador = criarRastreadorArquivos();
  const fila = criarFila(criarProcessadorDeItens(rastreador, { circuitBreaker: cb, contadorFalhas: contador }));

  const nomeArquivo = 'etapa7-bloqueio.pdf';
  const dadosPdf = await gerarPdfSintetico([[`$Q-Zap=${config.numeroAdmin}|Teste Etapa 7 bloqueio$`, 'Conteudo de teste']]);
  const caminhoArquivo = path.join(config.pastas.entrada, nomeArquivo);
  await writeFile(caminhoArquivo, dadosPdf);

  rastreador.registrarTotal(caminhoArquivo, 1);
  fila.adicionar({
    tipo: 'documento',
    arquivoOrigem: caminhoArquivo,
    nomeArquivoSalvo: nomeArquivo,
    numero: config.numeroAdmin,
    nome: 'Teste Etapa 7 bloqueio',
    pdfBytes: dadosPdf,
  });

  await new Promise((resolve) => setTimeout(resolve, 1500));
  const antesDeRetomar = (await readdir(config.pastas.enviados)).filter((a) => a.startsWith('etapa7-bloqueio'));
  assert(antesDeRetomar.length === 0, 'documento nao deveria ter sido enviado enquanto a fila estava pausada');

  await cb.retomar();

  const emEnviados = await aguardarArquivosEm(config.pastas.enviados, 'etapa7-bloqueio', 1, 30000);
  console.log(`ok: documento so foi enviado apos retomar() (${emEnviados})`);

  await limparPastas();
}

function pararEvolutionApi() {
  execSync('docker stop q-zap-evolution-api', { stdio: 'ignore' });
}

function iniciarEvolutionApi() {
  execSync('docker start q-zap-evolution-api', { stdio: 'ignore' });
}

async function testarCircuitBreakerPorFalhasReais() {
  console.log('\n=== cenario real: 3 falhas de envio consecutivas (Evolution API fora do ar) acionam o circuit breaker ===');
  console.log('Este teste para o container q-zap-evolution-api temporariamente e reinicia ao final.');
  await limparPastas();

  const cb = criarCircuitBreaker({ logger });
  const contador = criarContadorFalhasConsecutivas();
  const rastreador = criarRastreadorArquivos();
  const fila = criarFila(criarProcessadorDeItens(rastreador, { circuitBreaker: cb, contadorFalhas: contador }));
  const watcher = iniciarWatcher({
    logger,
    fila,
    rastreador,
    onRetomar: () => tratarRetomada({ circuitBreaker: cb }),
  });
  await watcher.awaitReady?.();

  console.log('parando q-zap-evolution-api...');
  pararEvolutionApi();

  const nomesArquivos = ['etapa7-falha1.pdf', 'etapa7-falha2.pdf', 'etapa7-falha3.pdf'];
  for (const nomeArquivo of nomesArquivos) {
    const dadosPdf = await gerarPdfSintetico([[`$Q-Zap=${config.numeroAdmin}|Teste Etapa 7 falha$`, 'Conteudo de teste']]);
    await writeFile(path.join(config.pastas.entrada, nomeArquivo), dadosPdf);
  }

  console.log('aguardando os 3 documentos esgotarem as tentativas e irem para erro/ (retry com backoff, pode levar ~1min)...');
  await aguardarArquivosEm(config.pastas.erro, 'etapa7-falha', 3, 180000);

  assert(cb.estaPausada() === true, 'circuitBreaker deveria estar pausado apos 3 falhas de envio consecutivas');
  const statusPath = path.join(config.pastas.base, 'status.txt');
  const conteudoStatus = await readFile(statusPath, 'utf-8');
  assert(conteudoStatus.includes('falhas de envio consecutivas'), 'status.txt deveria descrever o motivo da pausa');
  console.log('ok: 3 falhas consecutivas acionaram o circuit breaker, status.txt reflete a pausa');

  console.log('reiniciando q-zap-evolution-api...');
  iniciarEvolutionApi();
  await aguardarConexao({ logger, tentativas: 20, intervaloMs: 3000 });

  console.log('criando RETOMAR.txt para retomar o processamento...');
  const caminhoRetomar = path.join(config.pastas.base, 'RETOMAR.txt');
  await writeFile(caminhoRetomar, '');

  const inicio = Date.now();
  while (cb.estaPausada()) {
    if (Date.now() - inicio > 15000) throw new Error('timeout esperando circuitBreaker retomar apos RETOMAR.txt');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await assertArquivoNaoExiste(caminhoRetomar);
  await assertArquivoNaoExiste(statusPath);
  console.log('ok: RETOMAR.txt detectado, processamento retomado, status.txt e RETOMAR.txt autolimpos');
  console.log('Confira o WhatsApp do numero administrador: deve ter recebido o resumo retroativo da pausa.');

  await watcher.close();
  await limparPastas();
}

async function main() {
  await testarConfigurarWebhook();
  await testarBackoff();
  await testarContadorFalhas();
  await testarCircuitBreakerIsolado();
  await testarWebhookAcionaPausa();
  await testarBloqueioDuranteAPausa();
  await testarCircuitBreakerPorFalhasReais();
  console.log('\n=== Etapa 7: todos os testes passaram ===');
}

main().catch((erro) => {
  console.error('falha no teste manual da Etapa 7', erro);
  process.exit(1);
});
