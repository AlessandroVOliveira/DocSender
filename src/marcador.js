const REGEX_MARCADOR = /\$\s*Q-Zap\s*=\s*([\d\-\s()]+)\|\s*([^$]+)\$/i;
const REGEX_NUMERO_VALIDO = /^\d{12,13}$/;

export function sanitizarNumero(numero) {
  return numero.replace(/\D/g, '');
}

export function numeroValido(numero) {
  return REGEX_NUMERO_VALIDO.test(numero);
}

export function extrairMarcador(textoPagina) {
  const match = textoPagina.match(REGEX_MARCADOR);
  if (!match) {
    return { valido: false, motivo: 'marcador ausente ou malformado' };
  }

  const numero = sanitizarNumero(match[1]);
  const nome = match[2].trim();

  if (!numeroValido(numero)) {
    return { valido: false, motivo: `numero invalido apos sanitizacao: ${numero || '(vazio)'}` };
  }
  if (!nome) {
    return { valido: false, motivo: 'nome vazio no marcador' };
  }

  return { valido: true, numero, nome };
}
