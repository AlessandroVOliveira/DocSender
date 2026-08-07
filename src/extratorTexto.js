import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extrairTextoPorPagina(dadosPdf) {
  const tarefaCarregamento = getDocument({ data: dadosPdf });
  const paginas = [];
  try {
    const doc = await tarefaCarregamento.promise;
    for (let numero = 1; numero <= doc.numPages; numero += 1) {
      const pagina = await doc.getPage(numero);
      const conteudo = await pagina.getTextContent();
      const texto = conteudo.items.map((item) => item.str).join(' ');
      paginas.push(texto.replace(/\s+/g, ' ').trim());
    }
  } finally {
    await tarefaCarregamento.destroy();
  }
  return paginas;
}
