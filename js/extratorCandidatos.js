/* ============================================================================
   EXTRATORCANDIDATOS.JS — Fase 1 do checklist, seção "Extração".

   Diferença em relação à extração de classificadorExtrator.js:
   extrairCampos() lá é "melhor palpite": para cada campo (valorOferta,
   valorSentenca...) ele procura o(s) valor(es) mais próximo(s) de uma
   âncora textual específica ("oferta administrativa", "fixo a indenização
   em"...) e fica só com o mais provável. Isso é ótimo para preencher o
   formulário sozinho, mas descarta tudo que não bateu com nenhuma âncora.

   Este arquivo faz o oposto: varre TODAS as páginas e devolve TODO valor
   monetário, TODA data, TODO percentual e TODO número de processo que
   aparece no texto, tenha ou não âncora por perto. Serve de rede de
   segurança para a conferência manual — se o advogado sabe que o laudo
   menciona R$ 380.000,00 em algum lugar e esse valor não virou nenhum
   campo do formulário (porque a âncora não bateu), ele aparece aqui mesmo
   assim, com a página de origem.

   SAÍDA de cada extrator: lista de candidatos ÚNICOS (mesmo valor
   encontrado em páginas diferentes é agrupado em um único candidato), no
   formato:
     { valor, valorExibicao, vezes, ocorrencias: [{pagina, trecho}, ...] }

   `valor` já é o valor "de verdade" (number para moeda/percentual, ISO
   yyyy-mm-dd para data, string para nº de processo) — pronto para
   comparar/usar, sem precisar reconverter texto.

   DEPENDE de: as REGEX_* e as funções de parsing (parseValorMoedaBR,
   parsePercentualBR, parseDataBRParaIso, formatarDataIsoParaBR, contexto)
   já definidas em classificadorExtrator.js, e fmt/fmtPct de util.js —
   precisa carregar DEPOIS desses dois arquivos no index.html.
============================================================================ */

/* ------------------------------------------------------------------------
   1. HELPERS GENÉRICOS: varrer todas as ocorrências de uma regex em todas
   as páginas, e depois agrupar ocorrências que têm o mesmo valor.
------------------------------------------------------------------------ */
// `transformar(match, texto)` decide o que vira um candidato: recebe o
// resultado do regex.exec() e o texto da página, e devolve
// {valor, valorExibicao} ou null/undefined para descartar aquele match
// (ex.: data com mês inválido).
function coletarOcorrenciasCandidatas(paginas, regexFonte, transformar){
  const ocorrencias = [];
  paginas.forEach(p => {
    const texto = p.texto || '';
    const flags = regexFonte.flags.includes('g') ? regexFonte.flags : regexFonte.flags + 'g';
    const regexGlobal = new RegExp(regexFonte.source, flags);
    let m;
    while((m = regexGlobal.exec(texto)) !== null){
      const resultado = transformar(m, texto);
      if(resultado != null){
        ocorrencias.push({
          valor: resultado.valor,
          valorExibicao: resultado.valorExibicao,
          pagina: { numero: p.numero, arquivo: p.arquivo },
          trecho: contexto(texto, m.index, 60)
        });
      }
      if(m.index === regexGlobal.lastIndex) regexGlobal.lastIndex++; // evita loop infinito em casamento de tamanho zero
    }
  });
  return ocorrencias;
}

// Agrupa ocorrências com o mesmo valor (mesma `chaveFn(valor)`) em um único
// candidato, preservando todas as páginas/trechos onde apareceu — assim dá
// para ver, por exemplo, que "R$ 450.000,00" aparece 3 vezes (oferta,
// laudo e sentença) sem repetir o mesmo valor três vezes na lista.
function agruparCandidatosPorValor(ocorrencias, chaveFn){
  const mapa = new Map();
  ocorrencias.forEach(o => {
    const chave = chaveFn(o.valor);
    if(!mapa.has(chave)){
      mapa.set(chave, { valor: o.valor, valorExibicao: o.valorExibicao, ocorrencias: [] });
    }
    mapa.get(chave).ocorrencias.push({ pagina: o.pagina, trecho: o.trecho });
  });
  return Array.from(mapa.values())
    .map(candidato => ({ ...candidato, vezes: candidato.ocorrencias.length }));
}

/* ------------------------------------------------------------------------
   2. VALORES MONETÁRIOS CANDIDATOS (todo "R$X,XX" do documento)
------------------------------------------------------------------------ */
function extrairTodosValoresMonetariosCandidatos(paginas){
  const ocorrencias = coletarOcorrenciasCandidatas(paginas, REGEX_VALOR_RS, m => {
    const valor = parseValorMoedaBR(m[1]);
    if(valor === null) return null;
    return { valor, valorExibicao: fmt(valor) };
  });
  // chave com 2 casas fixas evita que erro de ponto-flutuante (0.1+0.2...)
  // separe por engano dois valores que são, na prática, o mesmo centavo.
  return agruparCandidatosPorValor(ocorrencias, v => v.toFixed(2));
}

/* ------------------------------------------------------------------------
   3. DATAS CANDIDATAS (toda data dd/mm/aaaa do documento)
------------------------------------------------------------------------ */
function extrairTodasDatasCandidatas(paginas){
  const ocorrencias = coletarOcorrenciasCandidatas(paginas, REGEX_DATA, m => {
    const iso = parseDataBRParaIso(m[1]);
    if(!iso) return null; // descarta data com dia/mês fora do intervalo válido
    return { valor: iso, valorExibicao: formatarDataIsoParaBR(iso) };
  });
  return agruparCandidatosPorValor(ocorrencias, v => v);
}

/* ------------------------------------------------------------------------
   4. PERCENTUAIS CANDIDATOS (todo "X%" do documento)
------------------------------------------------------------------------ */
function extrairTodosPercentuaisCandidatos(paginas){
  const ocorrencias = coletarOcorrenciasCandidatas(paginas, REGEX_PERCENTUAL, m => {
    const valor = parsePercentualBR(m[1]);
    if(valor === null) return null;
    return { valor, valorExibicao: fmtPct(valor, 2) };
  });
  return agruparCandidatosPorValor(ocorrencias, v => v.toFixed(4));
}

/* ------------------------------------------------------------------------
   5. NÚMEROS DE PROCESSO CANDIDATOS (todo nº no padrão CNJ do documento —
   normalmente só existe um por processo, mas processos apensados/conexos
   ou referências a outro processo no corpo do texto podem trazer mais de
   um; por isso a mesma lógica de "achar todos e agrupar" se aplica aqui.)
------------------------------------------------------------------------ */
function extrairTodosNumerosProcessoCandidatos(paginas){
  const ocorrencias = coletarOcorrenciasCandidatas(paginas, REGEX_NUMERO_PROCESSO, m => ({
    valor: m[1], valorExibicao: m[1]
  }));
  return agruparCandidatosPorValor(ocorrencias, v => v);
}

/* ------------------------------------------------------------------------
   6. ORQUESTRAÇÃO
------------------------------------------------------------------------ */
function extrairTodosCandidatos(paginas){
  return {
    valoresMonetarios: extrairTodosValoresMonetariosCandidatos(paginas),
    datas: extrairTodasDatasCandidatas(paginas),
    percentuais: extrairTodosPercentuaisCandidatos(paginas),
    numerosProcesso: extrairTodosNumerosProcessoCandidatos(paginas)
  };
}
