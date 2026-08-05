/* ============================================================================
   FIXTURES.JS — Documento-base realista (petição, laudo, sentença, depósito)
   e os 5 cenários de PDF pedidos na Fase 1 do checklist.

   Os campos que o documento-base foi escrito para permitir extrair (17-18
   campos, ver CAMPOS_ESPERADOS) foram calibrados olhando as âncoras/regex
   reais de js/classificadorExtrator.js — não são um "gabarito" arbitrário.
============================================================================ */

const CAMPOS_ESPERADOS = [
  'numeroProcesso', 'comarca', 'expropriante', 'expropriado',
  'valorOferta', 'dataOferta', 'valorPericial', 'areaImovel',
  'valorSentenca', 'dataSentenca', 'dataImissao', 'indice',
  'faixaCompTaxa', 'faixaMoraTaxa', 'percentualHonor',
  'existeDeposito', 'depositoValor', 'depositoData'
];

function calcularTaxaExtracao(campos, camposEsperados){
  camposEsperados = camposEsperados || CAMPOS_ESPERADOS;
  const encontrados = camposEsperados.filter(id => campos[id] !== undefined);
  return {
    encontrados: encontrados.length,
    total: camposEsperados.length,
    faltando: camposEsperados.filter(id => campos[id] === undefined),
    taxa: encontrados.length / camposEsperados.length
  };
}

/* ------------------------------------------------------------------------
   TEXTOS-BASE (limpos, "como se fossem" texto digital perfeito)
------------------------------------------------------------------------ */
const TEXTO_PETICAO =
  'MUNICÍPIO DE SÃO PAULO, pessoa jurídica de direito público interno, por ' +
  'seu procurador, vem, respeitosamente, à presença de Vossa Excelência ' +
  'propor a presente AÇÃO DE DESAPROPRIAÇÃO em face de JOÃO DA SILVA SANTOS, ' +
  'já qualificado, pelos fatos e fundamentos jurídicos a seguir expostos. ' +
  'Requer a citação do réu. Processo n. 0001234-56.2020.8.26.0100. Comarca ' +
  'de São Paulo. O expropriante formulou oferta administrativa no valor de ' +
  'R$ 380.000,00 em 10/03/2020.';

const TEXTO_CONTESTACAO =
  'CONTESTAÇÃO. O réu, em sede de contestação, impugna os termos da inicial ' +
  'e requer a improcedência do pedido, com a condenação do autor ao ' +
  'pagamento das custas processuais.';

const TEXTO_LAUDO =
  'LAUDO PERICIAL. O perito judicial, com base na NBR 14.653, apresenta os ' +
  'quesitos respondidos e a metodologia avaliatória adotada. O imóvel ' +
  'possui área de 1.200,00 m², situado na Rua das Flores, 100. O perito ' +
  'concluiu que o valor da indenização é de R$ 450.000,00.';

const TEXTO_SENTENCA =
  'SENTENÇA. Vistos, etc. Ante o exposto, julgo procedente o pedido e fixo ' +
  'a indenização em R$ 520.000,00, corrigida pelo IPCA-E desde a data da ' +
  'avaliação. A imissão provisória na posse ocorreu em 15/01/2020. Fixo ' +
  'juros compensatórios de 6,00% ao ano e juros moratórios de 1,00% ao ' +
  'mês. Condeno o expropriante ao pagamento de honorários advocatícios de ' +
  '10,00% sobre a diferença apurada. Sentença publicada em 20/09/2021.';

const TEXTO_DEPOSITO =
  'COMPROVANTE DE DEPÓSITO JUDICIAL. Foi realizado o depósito judicial no ' +
  'valor de R$ 380.000,00 em 12/03/2020, referente à oferta inicial.';

const TEXTO_FOLHA_BOILERPLATE_PADRAO =
  'Fls. __N__ - Processo eletrônico - Documento assinado digitalmente - ' +
  'Tribunal de Justiça - conforme Lei nº 11.419/2006.';

const TEXTOS_BASE_ORDENADOS = [TEXTO_PETICAO, TEXTO_CONTESTACAO, TEXTO_LAUDO, TEXTO_SENTENCA, TEXTO_DEPOSITO];

/* ------------------------------------------------------------------------
   RUÍDO DE OCR: corrompe só os dígitos "0" (a confusão 0↔O é a mais comum
   em OCR) mantendo pelo menos 2 dígitos reais por token — exatamente a
   condição que corrigirErrosComunsOcr (normalizadorTexto.js) exige para
   corrigir. Simula "OCR imperfeito" de forma determinística e realista,
   sem depender de aleatoriedade nos testes.
------------------------------------------------------------------------ */
function corromperZerosOcr(texto){
  return texto.replace(/0/g, 'O');
}

// Garbage genérico para representar uma tentativa de OCR ruim o bastante
// para ter confiança baixa e ser descartada pelo próprio pipeline (o
// conteúdo não importa — só precisa ter confiança abaixo do limiar).
function textoGaribadoIrreconhecivel(seed){
  return `%%${seed}## ilegível ¬¬¬ ruído de digitalização ___ ${seed}%%`;
}

/* ------------------------------------------------------------------------
   CENÁRIO A — PDF DIGITAL (texto extraído direto do pdf.js, sem OCR)
------------------------------------------------------------------------ */
function paginasPdfDigital(){
  return TEXTOS_BASE_ORDENADOS.map(texto => ({ digital: true, texto }));
}

/* ------------------------------------------------------------------------
   CENÁRIO B — PDF ESCANEADO, BOA QUALIDADE (OCR limpo, 1ª tentativa já
   tem confiança alta -> sem retentativa de resolução nem de rotação)
------------------------------------------------------------------------ */
function paginasPdfEscaneadoBoaQualidade(){
  return TEXTOS_BASE_ORDENADOS.map(texto => ({
    digital: false,
    textoDigitalCurto: '',
    ocr(){ return { texto, confianca: 92 }; }
  }));
}

/* ------------------------------------------------------------------------
   CENÁRIO C — PDF RUIM / BAIXA QUALIDADE (1ª tentativa em resolução
   padrão tem confiança baixa; retentativa em resolução maior recupera o
   texto, ainda com ruído numérico de OCR que a normalização deve corrigir)
------------------------------------------------------------------------ */
const ESCALA_OCR_PADRAO_TESTE = 2; // espelha ESCALA_OCR_PADRAO em leitorPdf.js
const ESCALA_OCR_ALTA_TESTE = 3;   // espelha ESCALA_OCR_ALTA em leitorPdf.js

function paginasPdfBaixaQualidade(){
  return TEXTOS_BASE_ORDENADOS.map((texto, i) => ({
    digital: false,
    textoDigitalCurto: '',
    ocr(escala){
      if(escala === ESCALA_OCR_PADRAO_TESTE){
        return { texto: textoGaribadoIrreconhecivel('pag' + i), confianca: 30 };
      }
      // resolução maior (retentativa): texto recuperável, com o erro
      // clássico de OCR 0↔O ainda presente — é isso que
      // corrigirErrosComunsOcr precisa corrigir.
      return { texto: corromperZerosOcr(texto), confianca: 78 };
    }
  }));
}

/* ------------------------------------------------------------------------
   CENÁRIO D — OCR IMPERFEITO POR PÁGINA GIRADA (digitalização por celular
   sem metadado de rotação: só a tentativa a 90° tem confiança alta; 0°,
   180° e 270° ficam ruins o bastante para forçar a varredura de rotação)
------------------------------------------------------------------------ */
function paginasOcrImperfeitoRotacao(){
  return TEXTOS_BASE_ORDENADOS.map((texto, i) => ({
    digital: false,
    textoDigitalCurto: '',
    rotacaoDeclarada: 0, // o PDF não declara rotação nenhuma (metadado ausente)
    ocr(escala, rotacaoTotal){
      if(rotacaoTotal === 90){
        return { texto: corromperZerosOcr(texto), confianca: 88 };
      }
      return { texto: textoGaribadoIrreconhecivel('pag' + i + '-rot' + rotacaoTotal), confianca: 20 };
    }
  }));
}

/* ------------------------------------------------------------------------
   CENÁRIO E — PDF DE MAIS DE 300 PÁGINAS (autos digitalizados de um
   processo real: a maioria das páginas é boilerplate/numeração de folhas,
   e as peças com os campos relevantes estão espalhadas em posições
   distantes entre si, para exercitar o processamento em lotes de principio
   a fim do arquivo)
------------------------------------------------------------------------ */
function paginasPdfGrande(totalPaginas){
  totalPaginas = totalPaginas || 350;
  const posicoes = {
    1: TEXTO_PETICAO,
    50: TEXTO_LAUDO,
    200: TEXTO_SENTENCA,
    [totalPaginas - 1]: TEXTO_DEPOSITO
  };
  const paginas = [];
  for(let n = 1; n <= totalPaginas; n++){
    const texto = posicoes[n] || TEXTO_FOLHA_BOILERPLATE_PADRAO.replace('__N__', String(n));
    paginas.push({ digital: true, texto });
  }
  return paginas;
}

module.exports = {
  CAMPOS_ESPERADOS,
  calcularTaxaExtracao,
  paginasPdfDigital,
  paginasPdfEscaneadoBoaQualidade,
  paginasPdfBaixaQualidade,
  paginasOcrImperfeitoRotacao,
  paginasPdfGrande
};
