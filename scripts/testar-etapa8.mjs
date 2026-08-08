import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { config } from '../config/config.js';
import { criarLogger } from '../src/logger.js';
import { salvarEmErro } from '../src/armazenamento.js';
import { criarRastreadorArquivos } from '../src/rastreadorArquivos.js';
import { criarProcessadorDeItens } from '../src/index.js';
import { criarFila } from '../src/fila.js';
import { iniciarWatcher } from '../src/watcher.js';
import { aguardarConexao } from '../src/evolutionClient.js';

const logger = pino({ level: 'info' });

function assert(condicao, mensagem) {
  if (!condicao) {
    throw new Error(`falha: ${mensagem}`);
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
        .filter((arquivo) => arquivo.toLowerCase().startsWith('etapa8-'))
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

async function testarRotacaoDeLog() {
  console.log('\n=== criarLogger: escreve log estruturado com rotacao diaria em logs/ ===');
  const loggerTeste = criarLogger();
  const marcador = `etapa8-log-${Date.now()}`;
  loggerTeste.info({ marcador }, 'evento de teste da etapa 8');

  const inicio = Date.now();
  let arquivoComMarcador;
  while (!arquivoComMarcador) {
    const arquivos = (await readdir(config.pastas.logs)).filter((arquivo) => /^q-zap\..*\.log$/.test(arquivo));
    for (const arquivo of arquivos) {
      const conteudo = await readFile(path.join(config.pastas.logs, arquivo), 'utf-8');
      if (conteudo.includes(marcador)) {
        arquivoComMarcador = arquivo;
        break;
      }
    }
    if (!arquivoComMarcador) {
      if (Date.now() - inicio > 10000) {
        throw new Error('timeout esperando o transport do pino gravar o evento de teste em logs/');
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log(`ok: log estruturado gravado em ${arquivoComMarcador}`);
}

async function testarErroLogTxt() {
  console.log('\n=== salvarEmErro: registra entrada legivel em erro/log.txt ===');
  const nomeArquivo = 'etapa8-erro-log-txt.pdf';
  const motivo = 'motivo de teste etapa 8';
  await salvarEmErro(nomeArquivo, Buffer.from('conteudo fake'), motivo);

  const conteudo = await readFile(path.join(config.pastas.erro, 'log.txt'), 'utf-8');
  assert(conteudo.includes(`${nomeArquivo} - ${motivo}`), 'erro/log.txt deveria conter a linha do documento de teste');
  console.log('ok: erro/log.txt recebeu a linha "<identificacao> - <motivo>"');

  await rm(path.join(config.pastas.erro, nomeArquivo));
}

async function testarRastreadorResultados() {
  console.log('\n=== rastreadorArquivos: acumula resultados e libera no ultimo item ===');
  const rastreador = criarRastreadorArquivos();
  const arquivo = 'etapa8-arquivo-fake.pdf';

  rastreador.registrarTotal(arquivo, 2);
  rastreador.registrarResultado(arquivo, { tipo: 'enviado', identificacao: 'doc1' });
  assert(rastreador.concluirItem(arquivo) === false, 'nao deveria concluir apos 1 de 2 itens');

  rastreador.registrarResultado(arquivo, { tipo: 'erro', identificacao: 'doc2', motivo: 'falha fake' });
  assert(rastreador.concluirItem(arquivo) === true, 'deveria concluir apos o 2o de 2 itens');

  const resultados = rastreador.obterResultados(arquivo);
  assert(resultados.length === 2, `esperava 2 resultados acumulados, recebeu ${resultados.length}`);
  assert(
    resultados[0].tipo === 'enviado' && resultados[1].tipo === 'erro',
    'resultados deveriam preservar tipo e ordem de chegada',
  );
  assert(rastreador.obterResultados(arquivo).length === 0, 'obterResultados deveria limpar o acumulado apos a leitura');

  console.log('ok: resultados acumulados corretamente e limpos apos obterResultados');
}

async function testarResumoRealAoFinalDoArquivo() {
  console.log('\n=== fluxo real: resumo de arquivo processado enviado ao numero administrador ===');
  await limparPastas();
  await aguardarConexao({ logger });

  const rastreador = criarRastreadorArquivos();
  const fila = criarFila(criarProcessadorDeItens(rastreador));
  const watcher = iniciarWatcher({ logger, fila, rastreador });
  await watcher.awaitReady?.();

  const nomeArquivo = 'etapa8-lote-misto.pdf';
  const dadosPdf = await gerarPdfSintetico([
    [`$Q-Zap=${config.numeroAdmin}|Teste Etapa 8$`, 'Conteudo de teste'],
    ['pagina sem marcador valido'],
  ]);
  await writeFile(path.join(config.pastas.entrada, nomeArquivo), dadosPdf);

  await aguardarArquivosEm(config.pastas.enviados, 'etapa8-lote-misto', 1, 60000);
  await aguardarArquivosEm(config.pastas.erro, 'etapa8-lote-misto', 1, 30000);
  await aguardarArquivosEm(config.pastas.processado, 'etapa8-lote-misto', 1, 30000);

  console.log('ok: 1 documento enviado, 1 movido para erro, arquivo original movido para processado/');
  console.log(
    'Confira o WhatsApp do numero administrador: deve ter recebido o resumo do arquivo com "Enviados: 1" e ' +
      '"Erros: 1" (com a identificacao e o motivo do erro).',
  );

  await watcher.close();
  await limparPastas();
}

async function main() {
  await testarRotacaoDeLog();
  await testarErroLogTxt();
  await testarRastreadorResultados();
  await testarResumoRealAoFinalDoArquivo();
  console.log('\n=== Etapa 8: todos os testes passaram ===');
}

main().catch((erro) => {
  console.error('falha no teste manual da Etapa 8', erro);
  process.exit(1);
});
