import { execSync, spawn } from 'node:child_process';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { config } from '../config/config.js';
import { aguardarConexao } from '../src/evolutionClient.js';

const resumoFinal = [];

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
        .filter((arquivo) => arquivo.toLowerCase().startsWith('etapa9-'))
        .map((arquivo) => rm(path.join(pasta, arquivo))),
    );
  }
  await rm(path.join(config.pastas.base, 'status.txt'), { force: true });
  await rm(path.join(config.pastas.base, 'RETOMAR.txt'), { force: true });
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

async function aguardarArquivoExiste(caminho, timeoutMs) {
  const inicio = Date.now();
  while (true) {
    try {
      await readFile(caminho);
      return;
    } catch (erro) {
      if (erro.code !== 'ENOENT') throw erro;
    }
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`timeout esperando ${caminho} existir`);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

function iniciarServico() {
  const processo = spawn(process.execPath, ['src/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processo.logLinhas = [];
  const capturar = (chunk) => {
    processo.logLinhas.push(...chunk.toString('utf-8').split('\n').filter(Boolean));
  };
  processo.stdout.on('data', capturar);
  processo.stderr.on('data', capturar);
  return processo;
}

async function aguardarBoot(processo, timeoutMs = 30000) {
  const inicio = Date.now();
  while (!processo.logLinhas.some((linha) => linha.includes('Q-Zap iniciado'))) {
    if (processo.exitCode !== null) {
      throw new Error(`servico encerrou durante o boot (codigo ${processo.exitCode}).\n${processo.logLinhas.join('\n')}`);
    }
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`timeout esperando o servico iniciar.\n${processo.logLinhas.join('\n')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function pararServico(processo, sinal = 'SIGKILL') {
  return new Promise((resolve) => {
    if (processo.exitCode !== null) return resolve();
    processo.once('exit', () => resolve());
    processo.kill(sinal);
  });
}

function contarLogs(linhas, filtros) {
  return linhas.filter((linha) => filtros.every((filtro) => linha.includes(filtro))).length;
}

async function lerContagemDiaria(numero) {
  try {
    const conteudo = await readFile(path.join(config.pastas.logs, 'contagem-diaria.json'), 'utf-8');
    const estado = JSON.parse(conteudo);
    return { data: estado.data, contagem: estado.contagens[numero] || 0 };
  } catch (erro) {
    if (erro.code === 'ENOENT') return { data: null, contagem: 0 };
    throw erro;
  }
}

function pararEvolutionApi() {
  execSync('docker stop q-zap-evolution-api', { stdio: 'ignore' });
}

function iniciarEvolutionApi() {
  execSync('docker start q-zap-evolution-api', { stdio: 'ignore' });
}

function registrar(criterio, passou, detalhe) {
  resumoFinal.push({ criterio, passou, detalhe });
  console.log(`${passou ? 'OK' : 'FALHA'}: ${criterio}${detalhe ? ' - ' + detalhe : ''}`);
}

async function prepararAmbiente() {
  console.log('\n=== preparando ambiente ===');
  await limparPastas();
  iniciarEvolutionApi();
  await aguardarConexao({ logger: console });
  console.log('ok: Evolution API conectada, pastas de teste limpas');
}

async function testarDocumentoUnico(processo) {
  console.log('\n=== Criterio 1: documento unico com marcador valido ===');
  const nomeArquivo = 'etapa9-doc-unico.pdf';
  const dadosPdf = await gerarPdfSintetico([[`$Q-Zap=${config.numeroAdmin}|Etapa9 Unico$`, 'Conteudo de teste']]);
  await writeFile(path.join(config.pastas.entrada, nomeArquivo), dadosPdf);

  await aguardarArquivosEm(config.pastas.enviados, 'etapa9-doc-unico', 1, 60000);
  await aguardarArquivosEm(config.pastas.processado, 'etapa9-doc-unico', 1, 15000);

  registrar('documento unico enviado e movido para enviados/processado', true);
  console.log('Confira no WhatsApp do numero administrador: mensagem "Etapa9 Unico" com anexo.');
}

async function testarLoteEDelay(processo) {
  console.log('\n=== Criterios 2 e 5: lote multi-cliente + delay observavel ===');
  const nomeArquivo = 'etapa9-lote.pdf';
  const clientes = ['Cliente A', 'Cliente B', 'Cliente C'];
  const dadosPdf = await gerarPdfSintetico(
    clientes.map((nome) => [`$Q-Zap=${config.numeroAdmin}|${nome}$`, 'Conteudo de teste']),
  );
  await writeFile(path.join(config.pastas.entrada, nomeArquivo), dadosPdf);

  const arquivosEnviados = await aguardarArquivosEm(config.pastas.enviados, 'etapa9-lote__doc', clientes.length, 90000);
  await aguardarArquivosEm(config.pastas.processado, 'etapa9-lote', 1, 15000);
  registrar('lote com 3 clientes dividido e cada documento enviado', true);

  const stats = await Promise.all(
    arquivosEnviados.map(async (arquivo) => ({ arquivo, mtime: (await stat(path.join(config.pastas.enviados, arquivo))).mtimeMs })),
  );
  stats.sort((a, b) => a.mtime - b.mtime);
  const gaps = [];
  for (let i = 1; i < stats.length; i++) {
    gaps.push(stats[i].mtime - stats[i - 1].mtime);
  }
  const minEsperadoMs = config.delay.minSec * 1000 - 300;
  const todosRespeitamDelay = gaps.every((gap) => gap >= minEsperadoMs);
  registrar(
    'delay aleatorio observavel entre envios consecutivos',
    todosRespeitamDelay,
    `gaps=${gaps.map((g) => Math.round(g)).join(',')}ms, minimo esperado=${minEsperadoMs}ms`,
  );
  if (!todosRespeitamDelay) {
    throw new Error(`gap entre envios menor que DELAY_MIN_SEC: ${gaps.join(',')}ms`);
  }
}

async function testarLoteComPaginaInvalida(processo) {
  console.log('\n=== Criterio 3: pagina sem marcador valido nao trava o lote ===');
  const nomeArquivo = 'etapa9-lote-erro.pdf';
  const dadosPdf = await gerarPdfSintetico([
    [`$Q-Zap=${config.numeroAdmin}|Lote Erro Doc1$`, 'Conteudo de teste'],
    ['pagina sem marcador valido'],
    [`$Q-Zap=${config.numeroAdmin}|Lote Erro Doc2$`, 'Conteudo de teste'],
  ]);
  await writeFile(path.join(config.pastas.entrada, nomeArquivo), dadosPdf);

  await aguardarArquivosEm(config.pastas.enviados, 'etapa9-lote-erro__doc', 2, 90000);
  await aguardarArquivosEm(config.pastas.erro, 'etapa9-lote-erro__erro', 1, 30000);
  await aguardarArquivosEm(config.pastas.processado, 'etapa9-lote-erro', 1, 15000);

  const logErro = await readFile(path.join(config.pastas.erro, 'log.txt'), 'utf-8');
  const linhaEsperada = logErro
    .split('\n')
    .some((linha) => linha.startsWith('etapa9-lote-erro__erro') && linha.includes('marcador'));
  registrar(
    'pagina invalida isolada em erro/, demais documentos do lote seguiram normalmente',
    linhaEsperada,
    linhaEsperada ? undefined : 'linha esperada nao encontrada em erro/log.txt',
  );
}

async function testarRestartNoMeioDoLote() {
  console.log('\n=== Criterio 4 / RNF01: reinicio do servico no meio de um lote ===');
  const nomeArquivo = 'etapa9-restart-lote.pdf';
  const caminhoArquivo = path.join(config.pastas.entrada, nomeArquivo);
  const nomes = ['Restart Doc 1', 'Restart Doc 2', 'Restart Doc 3', 'Restart Doc 4'];
  const dadosPdf = await gerarPdfSintetico(
    nomes.map((nome) => [`$Q-Zap=${config.numeroAdmin}|${nome}$`, 'Conteudo de teste']),
  );

  const { contagem: contagemAntes } = await lerContagemDiaria(config.numeroAdmin);

  console.log('iniciando servico (instancia 1)...');
  const servico1 = iniciarServico();
  await aguardarBoot(servico1);

  await writeFile(caminhoArquivo, dadosPdf);
  await aguardarArquivosEm(config.pastas.enviados, 'etapa9-restart-lote__doc1__', 1, 60000);
  console.log('1o documento do lote confirmado em enviados/, matando o processo agora (SIGKILL)...');
  await pararServico(servico1, 'SIGKILL');

  await assertArquivoNaoExiste(path.join(config.pastas.processado, nomeArquivo));
  const arquivoOrigemAindaEmEntrada = await readFile(caminhoArquivo).then(() => true).catch(() => false);
  assert(arquivoOrigemAindaEmEntrada, 'arquivo de entrada deveria continuar em entrada/, lote nao terminou antes do kill');

  console.log('reiniciando servico (instancia 2)...');
  const servico2 = iniciarServico();
  await aguardarBoot(servico2);

  await aguardarArquivosEm(config.pastas.processado, 'etapa9-restart-lote', 1, 90000);
  console.log('lote terminou de processar apos o restart, arquivo original movido para processado/');

  const logsCombinados = [...servico1.logLinhas, ...servico2.logLinhas];
  const envioDoc1 = contarLogs(logsCombinados, ['"nome":"Restart Doc 1"', 'documento enviado']);
  const semReenvio = envioDoc1 === 1;
  registrar(
    'documento ja enviado antes do restart nao foi reenviado (RNF01, caso de lote)',
    semReenvio,
    `"documento enviado" para Restart Doc 1 apareceu ${envioDoc1}x nos logs combinados das duas instancias`,
  );

  const { data: dataDepois, contagem: contagemDepois } = await lerContagemDiaria(config.numeroAdmin);
  const hoje = new Date().toISOString().slice(0, 10);
  const contagemSobreviveu = dataDepois === hoje && contagemDepois >= contagemAntes + 1;
  registrar(
    'contagem diaria por numero sobrevive ao restart no meio do dia sem resetar',
    contagemSobreviveu,
    `antes=${contagemAntes}, depois=${contagemDepois} (data=${dataDepois})`,
  );

  return servico2;
}

async function testarCircuitBreakerRetryRetomada(servicoAtivo) {
  console.log('\n=== Criterios 6 e 7: falha de envio -> retry -> circuit breaker -> RETOMAR.txt -> resumo retroativo ===');
  console.log('Este teste para o container q-zap-evolution-api temporariamente e reinicia ao final.');

  console.log('parando q-zap-evolution-api...');
  pararEvolutionApi();

  const nomesArquivos = ['etapa9-falha1.pdf', 'etapa9-falha2.pdf', 'etapa9-falha3.pdf'];
  for (const nomeArquivo of nomesArquivos) {
    const dadosPdf = await gerarPdfSintetico([[`$Q-Zap=${config.numeroAdmin}|Etapa9 Falha$`, 'Conteudo de teste']]);
    await writeFile(path.join(config.pastas.entrada, nomeArquivo), dadosPdf);
  }

  console.log('aguardando os 3 documentos esgotarem as tentativas de retry e irem para erro/ (backoff, pode levar alguns minutos)...');
  await aguardarArquivosEm(config.pastas.erro, 'etapa9-falha', 3, 240000);

  const tentativasLogadas = contarLogs(servicoAtivo.logLinhas, ['nova tentativa agendada']);
  registrar(
    'falha pontual de envio aciona retry com backoff antes de virar erro (RF12)',
    tentativasLogadas >= 3,
    `${tentativasLogadas} tentativas de retry logadas para os 3 documentos`,
  );

  const statusPath = path.join(config.pastas.base, 'status.txt');
  await aguardarArquivoExiste(statusPath, 5000);
  const conteudoStatus = await readFile(statusPath, 'utf-8');
  registrar(
    'circuit breaker pausa a fila apos falhas consecutivas e grava status.txt (RF13/RF19)',
    conteudoStatus.includes('falhas de envio consecutivas'),
    conteudoStatus.trim(),
  );

  console.log('reiniciando q-zap-evolution-api...');
  iniciarEvolutionApi();
  await aguardarConexao({ logger: console });

  console.log('criando RETOMAR.txt...');
  await writeFile(path.join(config.pastas.base, 'RETOMAR.txt'), '');

  const inicio = Date.now();
  while (true) {
    try {
      await readFile(statusPath);
    } catch (erro) {
      if (erro.code === 'ENOENT') break;
      throw erro;
    }
    if (Date.now() - inicio > 20000) throw new Error('timeout esperando status.txt sumir apos RETOMAR.txt');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  await assertArquivoNaoExiste(path.join(config.pastas.base, 'RETOMAR.txt'));
  registrar('RETOMAR.txt retoma o processamento e autolimpa status.txt/RETOMAR.txt (RF14/RF20)', true);
  console.log('Confira o WhatsApp do numero administrador: deve ter recebido o resumo retroativo da pausa.');
}

async function main() {
  await prepararAmbiente();

  const servico1 = iniciarServico();
  await aguardarBoot(servico1);

  await testarDocumentoUnico(servico1);
  await testarLoteEDelay(servico1);
  await testarLoteComPaginaInvalida(servico1);
  await pararServico(servico1, 'SIGKILL');

  const servico2 = await testarRestartNoMeioDoLote();
  await testarCircuitBreakerRetryRetomada(servico2);
  await pararServico(servico2, 'SIGKILL');

  await limparPastas();

  console.log('\n=== Resumo Etapa 9 ===');
  resumoFinal.forEach(({ criterio, passou, detalhe }) => {
    console.log(`${passou ? '[OK]   ' : '[FALHA]'} ${criterio}${detalhe ? ' :: ' + detalhe : ''}`);
  });
  const houveFalha = resumoFinal.some((item) => !item.passou);
  if (houveFalha) {
    console.log('\nUm ou mais criterios falharam, ver resumo acima.');
    process.exitCode = 1;
  } else {
    console.log('\ntodos os criterios verificados passaram.');
  }
}

main().catch((erro) => {
  console.error('falha no teste manual da Etapa 9', erro);
  process.exit(1);
});
