import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { config } from '../config/config.js';
import { criarProcessadorDeItens } from '../src/index.js';
import { criarFila } from '../src/fila.js';
import { criarRastreadorArquivos } from '../src/rastreadorArquivos.js';
import { iniciarWatcher } from '../src/watcher.js';
import { aguardarConexao } from '../src/evolutionClient.js';
import { calcularDelayMs, calcularDuracaoDigitandoMs } from '../src/antiban.js';
import { atingiuLimite, registrarEnvio } from '../src/limiteDiario.js';

const logger = pino({ level: 'info' });
const NUMERO_TESTE_LIMITE = '5599999999999';
const ARQUIVO_CONTAGEM = path.join(config.pastas.logs, 'contagem-diaria.json');

function assert(condicao, mensagem) {
  if (!condicao) {
    throw new Error(`falha: ${mensagem}`);
  }
}

async function testarCalculoDelay() {
  console.log('\n=== calcularDelayMs: amostragem ===');
  const minMs = config.delay.minSec * 1000;
  const maxMs = config.delay.maxSec * 1000;
  for (let i = 0; i < 50; i++) {
    const valor = calcularDelayMs();
    assert(valor >= minMs && valor <= maxMs, `delay ${valor}ms fora da faixa [${minMs}, ${maxMs}]`);
  }
  console.log(`ok: 50 amostras dentro da faixa [${minMs}, ${maxMs}]ms`);
}

async function testarCalculoDigitando() {
  console.log('\n=== calcularDuracaoDigitandoMs: clamp e formula ===');
  const { baseMs, msPorCaracter, maxMs } = config.digitando;

  const mensagemCurta = 'oi';
  const duracaoCurta = calcularDuracaoDigitandoMs(mensagemCurta.length);
  const esperadoCurto = baseMs + mensagemCurta.length * msPorCaracter;
  assert(
    duracaoCurta >= esperadoCurto && duracaoCurta < esperadoCurto + 500,
    `duracao curta ${duracaoCurta}ms fora do esperado (~${esperadoCurto}ms + jitter)`,
  );

  const mensagemLonga = 'x'.repeat(1000);
  const duracaoLonga = calcularDuracaoDigitandoMs(mensagemLonga.length);
  assert(
    duracaoLonga >= maxMs && duracaoLonga < maxMs + 500,
    `duracao longa ${duracaoLonga}ms deveria ficar no teto (~${maxMs}ms + jitter)`,
  );

  console.log(`ok: mensagem curta ~${Math.round(duracaoCurta)}ms, mensagem longa no teto ~${Math.round(duracaoLonga)}ms`);
}

async function testarLimiteDiario() {
  console.log('\n=== atingiuLimite / registrarEnvio ===');

  const semLimite = await atingiuLimite(NUMERO_TESTE_LIMITE);
  assert(semLimite === false, 'numero sem contagem previa nao deveria estar no limite');

  for (let i = 0; i < config.limiteDiarioPorNumero; i++) {
    await registrarEnvio(NUMERO_TESTE_LIMITE);
  }

  const noLimite = await atingiuLimite(NUMERO_TESTE_LIMITE);
  assert(noLimite === true, `apos ${config.limiteDiarioPorNumero} envios, numero deveria estar no limite`);

  console.log(`ok: bloqueado apos atingir LIMITE_DIARIO_POR_NUMERO (${config.limiteDiarioPorNumero})`);

  const conteudo = JSON.parse(await readFile(ARQUIVO_CONTAGEM, 'utf-8'));
  delete conteudo.contagens[NUMERO_TESTE_LIMITE];
  await writeFile(ARQUIVO_CONTAGEM, JSON.stringify(conteudo, null, 2));
  console.log('limpeza: numero de teste removido de logs/contagem-diaria.json');
}

async function gerarPaginaTexto(doc, linhas) {
  const fonte = await doc.embedFont(StandardFonts.Helvetica);
  const pagina = doc.addPage();
  linhas.forEach((linha, indice) => {
    pagina.drawText(linha, { x: 50, y: 750 - indice * 20, size: 12, font: fonte });
  });
}

async function gerarPdfSintetico(paginas) {
  const doc = await PDFDocument.create();
  for (const linhas of paginas) {
    await gerarPaginaTexto(doc, linhas);
  }
  return doc.save();
}

async function limparPastas() {
  for (const pasta of [config.pastas.entrada, config.pastas.enviados, config.pastas.erro, config.pastas.processado]) {
    const arquivos = await readdir(pasta);
    await Promise.all(
      arquivos
        .filter((arquivo) => arquivo.toLowerCase().startsWith('etapa6-'))
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

async function testarFluxoRealComThrottling() {
  console.log('\n=== fluxo real: delay + digitando antes do envio ===');
  await limparPastas();
  await aguardarConexao({ logger });

  const rastreador = criarRastreadorArquivos();
  const fila = criarFila(criarProcessadorDeItens(rastreador));
  const watcher = iniciarWatcher({ logger, fila, rastreador });
  await watcher.awaitReady?.();

  const nomeArquivo = 'etapa6-documento-valido.pdf';
  const dadosPdf = await gerarPdfSintetico([[`$Q-Zap=${config.numeroAdmin}|Teste Etapa 6$`, 'Conteudo de teste']]);

  const inicio = Date.now();
  await writeFile(path.join(config.pastas.entrada, nomeArquivo), dadosPdf);

  const emEnviados = await aguardarArquivosEm(config.pastas.enviados, 'etapa6-documento-valido', 1, 60000);
  const decorridoMs = Date.now() - inicio;

  const minEsperadoMs = config.delay.minSec * 1000 + config.digitando.baseMs;
  assert(
    decorridoMs >= minEsperadoMs,
    `envio ocorreu em ${decorridoMs}ms, esperado pelo menos ~${minEsperadoMs}ms de delay+digitando`,
  );

  console.log(`ok: envio para enviados/ (${emEnviados}) levou ${decorridoMs}ms (>= ${minEsperadoMs}ms esperado)`);
  console.log('Confira o WhatsApp do numero administrador: deve ter mostrado "digitando..." antes de receber o documento.');

  await watcher.close();
  await limparPastas();
}

async function main() {
  await testarCalculoDelay();
  await testarCalculoDigitando();
  await testarLimiteDiario();
  await testarFluxoRealComThrottling();
  console.log('\n=== Etapa 6: todos os testes passaram ===');
}

main().catch((erro) => {
  console.error('falha no teste manual da Etapa 6', erro);
  process.exit(1);
});
