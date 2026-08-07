import { PDFDocument } from 'pdf-lib';

export async function carregarPdfOrigem(dadosPdf) {
  return PDFDocument.load(dadosPdf);
}

export async function gerarPdfGrupo(origem, paginas) {
  const destino = await PDFDocument.create();
  const indices = paginas.map((numeroPagina) => numeroPagina - 1);
  const copiadas = await destino.copyPages(origem, indices);
  copiadas.forEach((pagina) => destino.addPage(pagina));
  return destino.save();
}
