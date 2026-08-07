export function criarFila(processarItem) {
  const itens = [];
  let processando = false;

  async function processarProximo() {
    if (processando) return;
    processando = true;
    try {
      while (itens.length > 0) {
        const item = itens.shift();
        await processarItem(item);
      }
    } finally {
      processando = false;
    }
  }

  function adicionar(item) {
    itens.push(item);
    processarProximo();
  }

  return { adicionar };
}
