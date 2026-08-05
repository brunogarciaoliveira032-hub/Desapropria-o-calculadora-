/* ============================================================================
   FIXTURES-IA.JS — Documentos-teste específicos para a seção "IA" do
   checklist (js/classificadorExtrator.js + js/inteligenciaJuridica.js).

   O documento-base de tests/fixtures.js (petição + contestação + laudo +
   sentença + depósito) já cobre valores/datas/índice/juros em condição
   "limpa" — é reaproveitado aqui via paginasPdfDigital(). Este arquivo só
   acrescenta os textos que aquele documento-base não tem: marcadores de
   modalidade (direta/indireta), índice ambíguo, índice fora de página de
   sentença, datas ilógicas e sentença sem menção a juros — para exercitar
   as heurísticas de inteligenciaJuridica.js que o cenário "limpo" nunca
   aciona.
============================================================================ */

/* ------------------------------------------------------------------------
   MODALIDADE — DESAPROPRIAÇÃO DIRETA (marcadores fortes e concordantes)
------------------------------------------------------------------------ */
const TEXTO_PETICAO_DIRETA =
  'MUNICÍPIO DE SÃO PAULO propõe AÇÃO DE DESAPROPRIAÇÃO DIRETA em face de ' +
  'JOÃO DA SILVA SANTOS, com base no decreto de utilidade pública nº ' +
  '12.345/2019 e no Decreto-Lei nº 3.365/41. Requer depósito prévio para ' +
  'fins de imissão provisória na posse do imóvel. Processo n. ' +
  '0001234-56.2020.8.26.0100.';

function paginasModalidadeDireta(){
  return [{ digital: true, texto: TEXTO_PETICAO_DIRETA }];
}

/* ------------------------------------------------------------------------
   MODALIDADE — DESAPROPRIAÇÃO INDIRETA (marcadores fortes e concordantes)
------------------------------------------------------------------------ */
const TEXTO_PETICAO_INDIRETA =
  'JOÃO DA SILVA SANTOS propõe AÇÃO INDENIZATÓRIA POR DESAPROPRIAÇÃO ' +
  'INDIRETA em face do MUNICÍPIO DE SÃO PAULO, em razão de apossamento ' +
  'administrativo do imóvel ocorrido sem prévio processo formal de ' +
  'desapropriação. Processo n. 0009876-54.2021.8.26.0100.';

function paginasModalidadeIndireta(){
  return [{ digital: true, texto: TEXTO_PETICAO_INDIRETA }];
}

/* ------------------------------------------------------------------------
   MODALIDADE — AMBÍGUA (marcadores de ambos os lados, sem lado
   claramente predominante: "imissão provisória na posse", peso 1, de um
   lado; "ocupação de fato", peso 1, do outro — diferença 0, abaixo do
   limiar de 2 pontos exigido para decidir)
------------------------------------------------------------------------ */
const TEXTO_PETICAO_AMBIGUA =
  'Trata-se de processo envolvendo imissão provisória na posse do imóvel ' +
  'pelo Município, que já vinha em ocupação de fato da área há alguns ' +
  'meses antes do ajuizamento. Processo n. 0005555-11.2020.8.26.0100.';

function paginasModalidadeAmbigua(){
  return [{ digital: true, texto: TEXTO_PETICAO_AMBIGUA }];
}

/* ------------------------------------------------------------------------
   ÍNDICE — AMBÍGUO (dois índices mencionados na página de sentença)
------------------------------------------------------------------------ */
const TEXTO_SENTENCA_INDICE_AMBIGUO =
  'SENTENÇA. Ante o exposto, julgo procedente o pedido e fixo a ' +
  'indenização em R$ 520.000,00, corrigida pelo IPCA-E desde a data da ' +
  'avaliação, observado ainda o entendimento consolidado de aplicação da ' +
  'taxa Selic a partir de dezembro de 2021. Sentença publicada em ' +
  '20/09/2021.';

function paginasIndiceAmbiguo(){
  return [{ digital: true, texto: TEXTO_SENTENCA_INDICE_AMBIGUO }];
}

/* ------------------------------------------------------------------------
   ÍNDICE — SÓ MENÇÃO SOLTA, FORA DE SENTENÇA/ACÓRDÃO (deve cair na
   Camada 2 do extrator: confiança mais baixa, com observação explícita)
------------------------------------------------------------------------ */
const TEXTO_PETICAO_INDICE_SOLTO =
  'MUNICÍPIO DE SÃO PAULO propõe a presente AÇÃO DE DESAPROPRIAÇÃO, ' +
  'requerendo que os valores sejam corrigidos pelos índices oficiais, ' +
  'atualmente a taxa Selic, além dos juros legais.';

function paginasIndiceSolto(){
  return [{ digital: true, texto: TEXTO_PETICAO_INDICE_SOLTO }];
}

/* ------------------------------------------------------------------------
   DATAS — DATA FUTURA (erro de leitura/OCR) e ORDEM CRONOLÓGICA
   IMPROVÁVEL (sentença antes da oferta)
------------------------------------------------------------------------ */
function paginasDataFutura(){
  return [{
    digital: true,
    texto: 'O expropriante formulou oferta administrativa no valor de ' +
      'R$ 380.000,00 em 10/03/2099.'
  }];
}

function paginasOrdemCronologicaImprovavel(){
  return [{
    digital: true,
    texto: 'O expropriante formulou oferta administrativa no valor de ' +
      'R$ 380.000,00 em 10/03/2022. SENTENÇA. Ante o exposto, julgo ' +
      'procedente o pedido. Sentença publicada em 20/09/2021.'
  }];
}

/* ------------------------------------------------------------------------
   JUROS — SENTENÇA SEM MENÇÃO A JUROS (campo deve ficar ausente, não
   quebrar o pipeline nem inventar valor)
------------------------------------------------------------------------ */
const TEXTO_SENTENCA_SEM_JUROS =
  'SENTENÇA. Ante o exposto, julgo procedente o pedido e fixo a ' +
  'indenização em R$ 520.000,00. Sentença publicada em 20/09/2021.';

function paginasSentencaSemJuros(){
  return [{ digital: true, texto: TEXTO_SENTENCA_SEM_JUROS }];
}

module.exports = {
  paginasModalidadeDireta,
  paginasModalidadeIndireta,
  paginasModalidadeAmbigua,
  paginasIndiceAmbiguo,
  paginasIndiceSolto,
  paginasDataFutura,
  paginasOrdemCronologicaImprovavel,
  paginasSentencaSemJuros
};
