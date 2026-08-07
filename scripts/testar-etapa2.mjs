import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { processarArquivoPdf } from '../src/processarPdf.js';

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

const CASOS = [
  {
    nome: 'documento-unico-uma-pagina',
    paginas: [['$Q-Zap=5511999998888|Joao Silva$', 'Conteudo do relatorio pagina 1']],
  },
  {
    nome: 'documento-unico-multi-pagina',
    paginas: [
      ['$Q-Zap=5511999998888|Joao Silva$', 'Boleto pagina 1'],
      ['$Q-Zap=5511999998888|Joao Silva$', 'Boleto pagina 2'],
    ],
  },
  {
    nome: 'lote-multi-cliente',
    paginas: [
      ['$Q-Zap=5511999998888|Joao Silva$', 'Cliente A pagina 1'],
      ['$Q-Zap=5511999998888|Joao Silva$', 'Cliente A pagina 2'],
      ['$Q-Zap=5555996188546|Maria Souza$', 'Cliente B pagina 1'],
    ],
  },
  {
    nome: 'lote-com-pagina-invalida-no-meio',
    paginas: [
      ['$Q-Zap=5511999998888|Joao Silva$', 'Cliente A'],
      ['Relatorio sem marcador nenhum'],
      ['$Q-Zap=abc|Nome Qualquer$', 'numero invalido apos sanitizacao'],
      ['$Q-Zap=5555996188546|Maria Souza$', 'Cliente B'],
    ],
  },
];

async function main() {
  const pastaSaida = path.join('scripts', 'saida-teste-etapa2');
  await mkdir(pastaSaida, { recursive: true });

  for (const caso of CASOS) {
    console.log(`\n=== ${caso.nome} ===`);
    const dadosPdf = await gerarPdfSintetico(caso.paginas);
    const { documentos, erros } = await processarArquivoPdf(dadosPdf);

    console.log(`documentos: ${documentos.length}, erros: ${erros.length}`);
    for (const doc of documentos) {
      console.log(`  documento numero=${doc.numero} nome="${doc.nome}" paginas=${JSON.stringify(doc.paginas)} pdfBytes=${doc.pdfBytes.length}`);
      await writeFile(path.join(pastaSaida, `${caso.nome}-doc-${doc.numero}.pdf`), doc.pdfBytes);
    }
    for (const [indice, erro] of erros.entries()) {
      console.log(`  erro motivo="${erro.motivo}" paginas=${JSON.stringify(erro.paginas)} pdfBytes=${erro.pdfBytes.length}`);
      await writeFile(path.join(pastaSaida, `${caso.nome}-erro-${indice}.pdf`), erro.pdfBytes);
    }
  }

  console.log('\n=== arquivo real do ERP (marcador sem terminador, deve virar erro) ===');
  const dadosReais = await readFile(path.join('testes', 'teste 1.pdf'));
  const resultado = await processarArquivoPdf(new Uint8Array(dadosReais));
  console.log(`documentos: ${resultado.documentos.length}, erros: ${resultado.erros.length}`);
  for (const erro of resultado.erros) {
    console.log(`  erro motivo="${erro.motivo}" paginas=${JSON.stringify(erro.paginas)}`);
  }
}

main().catch((erro) => {
  console.error('falha no teste manual da Etapa 2', erro);
  process.exit(1);
});
