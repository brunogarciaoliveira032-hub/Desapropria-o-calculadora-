/* ============================================================================
   NORMALIZADORTEXTO.JS — Fase 1 do checklist: aumentar a precisão da
   extração, normalizando o texto ANTES de classificadorExtrator.js rodar
   suas regex sobre ele.

   Cobre os 4 itens da seção "OCR" da Fase 1:
     1) corrigirErrosComunsOcr — O→0, I→1, l→1, S→5, B→8, só dentro de
        trechos que já parecem números (nunca em palavras comuns).
     2) normalizarMoedas — "R$450000" / "R$450.000" / "R$450000,00" (e a
        variante americana "R$450,000.00") viram todos "R$ 450.000,00".
     3) normalizarDatas — datas com separador ".", "-" ou espaços em volta,
        e datas por extenso ("5 de março de 2020"), viram "dd/mm/aaaa".
     4) limparEspacamento — quebras de linha, espaços duplicados e hífen de
        fim de linha ("inde-\nnização") indevidos.

   ONDE ISSO ENTRA NO PIPELINE: chamado por leitorPdf.js logo depois de obter
   o texto de cada página (digital ou OCR), ANTES de a página ser empilhada
   em `paginas` — ou seja, tudo que roda depois (classificadorExtrator.js,
   inteligenciaJuridica.js) já recebe o texto normalizado. Não há nenhuma
   regra jurídica aqui, só limpeza/normalização de formato.

   DEPENDE de: nada (funções puras sobre string). Precisa carregar ANTES de
   leitorPdf.js no index.html.
============================================================================ */

/* ------------------------------------------------------------------------
   1. ESPAÇAMENTO, QUEBRAS DE LINHA E HÍFEN INDEVIDO DE FIM DE LINHA
------------------------------------------------------------------------ */
// Junta palavra quebrada por hífen de fim de linha (ex.: "inde-\nnização" ou,
// já com a quebra virada espaço em etapa anterior, "inde- nização"). Só junta
// quando o hífen é seguido de espaço/quebra E a próxima letra é minúscula —
// isso evita comer hífens de palavra composta legítima (que não tem espaço
// depois do hífen: "guarda-chuva" nunca bate aqui) e evita juntar por engano
// um hífen que na verdade terminava uma frase antes de nova frase/título em
// maiúscula.
function limparEspacamento(texto){
  if(!texto) return texto;
  let out = String(texto);
  out = out.replace(/\r\n|\r/g, '\n');
  out = out.replace(/([a-zà-ÿ])-\s*\n\s*([a-zà-ÿ])/gi, '$1$2');
  out = out.replace(/([a-zà-ÿ])-[ \t]+([a-zà-ÿ])/g, '$1$2');
  out = out.replace(/\n+/g, ' ');
  out = out.replace(/[ \t]+/g, ' ').trim();
  return out;
}

/* ------------------------------------------------------------------------
   2. ERROS COMUNS DE OCR (letra ↔ dígito) — SÓ DENTRO DE NÚMEROS
   Trocar O/I/l/S/B por 0/1/1/5/8 em qualquer lugar do texto destruiria
   palavras comuns ("Sol", "Isso", "Boa"...). Por isso a correção só entra
   dentro de um "token numérico": uma sequência contígua formada por
   dígitos, essas 5 letras específicas (maiúsculas, exceto o "l" minúsculo —
   é assim que o erro aparece de fato no OCR) e os separadores . , / -, E
   que já contenha pelo menos 2 dígitos DE VERDADE. Essa exigência de 2
   dígitos reais é a rede de segurança: uma palavra comum não tem dígito
   nenhum, então nunca é tocada; um token como "R$45O.OOO,OO" (2 dígitos
   reais: 4 e 5) vira "R$450.000,00".
------------------------------------------------------------------------ */
const MAPA_OCR_NUMERICO = { 'O': '0', 'I': '1', 'l': '1', 'S': '5', 'B': '8' };
const REGEX_TOKEN_NUMERICO_OCR = /[0-9OIlSB](?:[0-9OIlSB.,\/-]*[0-9OIlSB])?/g;

function corrigirErrosComunsOcr(texto){
  if(!texto) return texto;
  return texto.replace(REGEX_TOKEN_NUMERICO_OCR, token => {
    const digitosReais = (token.match(/[0-9]/g) || []).length;
    if(digitosReais < 2) return token; // sem isso, "OI", "SB" etc. virariam número por engano
    return token.replace(/[OIlSB]/g, ch => MAPA_OCR_NUMERICO[ch]);
  });
}

// Correção adicional para números ANCORADOS por "R$" (antes) ou "%"
// (depois): nesses casos o contexto já deixa claro que é um número, então
// a exigência de 2 dígitos reais de corrigirErrosComunsOcr (acima) fica
// forte demais e deixa passar sem corrigir taxas comuns de um único
// dígito real — o caso mais frequente neste domínio é justamente juros
// compensatórios de 6% a.a. (art. 15-A do Decreto-Lei 3.365/41), que um
// OCR ruim lê como "6,OO%" (1 dígito real: o "6") e ficava sem correção.
function corrigirTokenNumericoOcr(token){
  return token.replace(/[OIlSB]/g, ch => MAPA_OCR_NUMERICO[ch]);
}
const REGEX_MOEDA_OCR_ANCORADA = /(R\$\s?)([0-9OIlSB](?:[0-9OIlSB.,\/]*[0-9OIlSB])?)/g;
const REGEX_PERCENTUAL_OCR_ANCORADO = /(\d(?:[0-9OIlSB.,]*[0-9OIlSB])?)(\s?%)/g;

function corrigirErrosOcrAncorados(texto){
  if(!texto) return texto;
  let out = texto.replace(REGEX_MOEDA_OCR_ANCORADA, (m, prefixo, numero) => prefixo + corrigirTokenNumericoOcr(numero));
  out = out.replace(REGEX_PERCENTUAL_OCR_ANCORADO, (m, numero, sufixo) => corrigirTokenNumericoOcr(numero) + sufixo);
  return out;
}

/* ------------------------------------------------------------------------
   3. NORMALIZAÇÃO DE DATAS — formatos variados -> dd/mm/aaaa
   (o formato dd/mm/aaaa é o que REGEX_DATA, em classificadorExtrator.js,
   já sabe reconhecer)
------------------------------------------------------------------------ */
const MESES_EXTENSO = {
  janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
};

function removerAcentos(s){
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Protege trechos no padrão CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO) antes de
// normalizarDatas() rodar: sem isso, a regex de data numérica (item 3.2)
// casava com pedaços do próprio número de processo (ex.: em
// "...2020.8.26.0100", o trecho "8.26.0100" batia como dia=8/mês=26/ano=0100
// e virava "08/26/0100"), destruindo o número de processo e derrubando a
// extração de `numeroProcesso` (REGEX_NUMERO_PROCESSO em
// classificadorExtrator.js) para praticamente qualquer PDF de processo
// judicial real.
const REGEX_NUMERO_PROCESSO_PROTEGER = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g;
const MARCADOR_CNJ = '\u0000CNJ';

function protegerNumerosProcesso(texto){
  const encontrados = [];
  const out = texto.replace(REGEX_NUMERO_PROCESSO_PROTEGER, m => {
    encontrados.push(m);
    return `${MARCADOR_CNJ}${encontrados.length - 1}\u0000`;
  });
  return { out, encontrados };
}

function restaurarNumerosProcesso(texto, encontrados){
  if(!encontrados.length) return texto;
  return texto.replace(/\u0000CNJ(\d+)\u0000/g, (m, i) => encontrados[+i]);
}

function normalizarDatas(texto){
  if(!texto) return texto;
  const protegido = protegerNumerosProcesso(texto);
  let out = protegido.out;

  // 3.1 Datas por extenso: "5 de março de 2020" / "05 de Março de 2.020" -> "05/03/2020"
  out = out.replace(
    /\b(\d{1,2})\s*(?:de)?\s*(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:de)?\s*(\d{1}\.?\d{3})\b/gi,
    (m, dia, mes, ano) => {
      const mesNum = MESES_EXTENSO[removerAcentos(mes).toLowerCase()];
      if(!mesNum) return m;
      return `${dia.padStart(2, '0')}/${mesNum}/${ano.replace('.', '')}`;
    }
  );

  // 3.2 Datas numéricas com separador "." ou "-" (em vez de "/") e/ou com
  // espaços em volta do separador (ruído comum de OCR: "12 / 03 / 2020",
  // "12.03.2020", "12-03-2020") -> "12/03/2020"
  out = out.replace(
    /\b(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})\b/g,
    (m, d, mo, a) => `${d.padStart(2, '0')}/${mo.padStart(2, '0')}/${a}`
  );

  return restaurarNumerosProcesso(out, protegido.encontrados);
}

/* ------------------------------------------------------------------------
   4. NORMALIZAÇÃO DE MOEDA — formatos variados -> "R$ 1.234.567,89"
   (o formato "R$X.XXX,XX" é o que REGEX_VALOR_RS, em
   classificadorExtrator.js, já sabe reconhecer)

   Estratégia: dentro do que vem depois de "R$", o ÚLTIMO separador (ponto
   OU vírgula) só é tratado como separador DECIMAL se for seguido de
   exatamente 2 dígitos — é assim que se distingue "450.000" (sem centavos,
   ponto de milhar) de "450000,00" (com centavos, vírgula decimal) e também
   cobre de brinde o formato americano "450,000.00" (ponto decimal no fim).
   Sem separador nenhum, o valor é tratado como inteiro (",00" implícito).
------------------------------------------------------------------------ */
const REGEX_MOEDA_CANDIDATA = /R\$\s?(\d[\d.,]*\d|\d)/g;

function parseNumeroMoedaAmbiguo(bruto){
  const limpo = bruto.replace(/\s+/g, '');
  const separadores = limpo.match(/[.,]/g) || [];
  let parteInteira, centavos;

  if(!separadores.length){
    parteInteira = limpo;
    centavos = '00';
  } else {
    const ultimoSep = separadores[separadores.length - 1];
    const idxUltimo = limpo.lastIndexOf(ultimoSep);
    const depoisDoUltimo = limpo.slice(idxUltimo + 1);
    if(depoisDoUltimo.length === 2){
      // último separador é decimal (cobre tanto "450000,00" quanto o
      // formato americano "450,000.00", já que só olhamos a posição, não
      // qual símbolo é usado)
      centavos = depoisDoUltimo;
      parteInteira = limpo.slice(0, idxUltimo).replace(/[.,]/g, '');
    } else {
      // nenhum separador aqui é decimal -> tudo é parte inteira (ex.: "450.000")
      parteInteira = limpo.replace(/[.,]/g, '');
      centavos = '00';
    }
  }

  parteInteira = parteInteira.replace(/^0+(?=\d)/, '') || '0';
  const parteInteiraComPontos = parteInteira.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${parteInteiraComPontos},${centavos}`;
}

function normalizarMoedas(texto){
  if(!texto) return texto;
  return texto.replace(REGEX_MOEDA_CANDIDATA, (m, valorBruto) => `R$ ${parseNumeroMoedaAmbiguo(valorBruto)}`);
}

/* ------------------------------------------------------------------------
   5. ORQUESTRAÇÃO — chamada por leitorPdf.js para cada página lida
   `fonte` é 'digital' ou 'ocr' (ver leitorPdf.js). A correção de letra↔dígito
   (item 2) só roda em texto vindo de OCR: texto digital (extraído
   diretamente do PDF, sem passar por reconhecimento de imagem) não tem esse
   tipo de erro, então rodar essa etapa nele só custaria tempo à toa.
------------------------------------------------------------------------ */
function normalizarTextoExtraido(texto, fonte){
  if(!texto) return texto;
  let out = limparEspacamento(texto);
  if(fonte === 'ocr'){
    out = corrigirErrosOcrAncorados(out); // casos ancorados por R$/%, mesmo com só 1 dígito real
    out = corrigirErrosComunsOcr(out);    // caso geral (2+ dígitos reais no token)
  }
  out = normalizarDatas(out);
  out = normalizarMoedas(out);
  out = limparEspacamento(out); // 2ª passada: as trocas acima podem deixar espaço duplo
  return out;
}
