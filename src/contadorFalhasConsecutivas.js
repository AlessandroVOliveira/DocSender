export function criarContadorFalhasConsecutivas() {
  let contagem = 0;

  function registrarFalha() {
    contagem += 1;
    return contagem;
  }

  function registrarSucesso() {
    contagem = 0;
  }

  return { registrarFalha, registrarSucesso };
}
