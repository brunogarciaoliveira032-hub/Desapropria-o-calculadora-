/* ============================================================================
   INDICES.JS — Integração com a API do Banco Central (SGS) e motor de
   aplicação dos índices de correção monetária.

   Extraído do arquivo original "calculadora_desapropriacao-parte1-motor-por
   -tipo-1.html", seções "1. Configuração e constantes" (parte referente aos
   índices), "5. Integração com a API do Banco Central" e "6. Motor de
   cálculo" (na parte específica de MONTAGEM DA MEMÓRIA DE CORREÇÃO, isto é,
   obter a série de um índice e transformá-la em fator acumulado mês a mês).
   Nenhuma alteração de lógica — apenas realocação de código.

   DEPENDE de js/util.js já carregado antes deste arquivo (usa $, fmt,
   listarCompetencias, competenciaLabel, isoParaBcb).

   NÃO pertence a este arquivo (ficam para motor.js): juros compensatórios,
   juros moratórios, honorários, montagem do ledger/totais — isto é,
   tudo que CONSOME o resultado da correção monetária mas não faz parte de
   obter/aplicar o índice em si.
============================================================================ */

/* ------------------------------------------------------------------------
   1. CONFIGURAÇÃO DOS ÍNDICES
------------------------------------------------------------------------ */

// Códigos das séries temporais do SGS/Bacen usadas pela calculadora.
const BCB_SERIES = {
  selic: 4390,   // Selic acumulada no mês (%) — usada para correção monetária
  ipca: 433,     // IPCA — variação mensal (%)
  ipcae: 10764,  // IPCA-E — variação mensal (%)
  inpc: 188,     // INPC — variação mensal (%) (IBGE, série SGS/Bacen)
  selicMeta: 432 // Meta Selic definida pelo Copom (% a.a.) — taxa legal de juros
};

const NOMES_INDICE = {
  selic: 'Selic (acumulada no mês)',
  ipca: 'IPCA',
  ipcae: 'IPCA-E',
  inpc: 'INPC',
  manual: 'Taxa personalizada',
  sentenca: 'Conforme sentença (índice transcrito)'
};

/* ------------------------------------------------------------------------
   2. INTEGRAÇÃO COM A API DO BANCO CENTRAL (com fallback inteligente)
------------------------------------------------------------------------ */

// Busca a série completa de um índice do Bacen entre duas datas ISO.
// Retorna um array de {data:'dd/mm/aaaa', valor:'x,xx'} ou lança erro.
async function buscarSerieBcb(codigo, dataIniIso, dataFimIso){
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados` +
              `?formato=json&dataInicial=${isoParaBcb(dataIniIso)}&dataFinal=${isoParaBcb(dataFimIso)}`;
  const resp = await fetch(url);
  if(!resp.ok) throw new Error('Resposta HTTP ' + resp.status);
  const data = await resp.json();
  if(!Array.isArray(data)) throw new Error('Formato de resposta inesperado');
  return data;
}

// CORREÇÃO (checklist — prioridade ALTA, "Atualização automática dos
// índices"): cache local em localStorage, por chave de série+período, para:
//   (a) permitir funcionamento offline quando a API do Bacen estiver fora
//       do ar (usa a última série já obtida com sucesso para a MESMA
//       consulta, em vez de simplesmente falhar ou cair para a taxa manual);
//   (b) registrar a data/hora em que aquela série foi efetivamente obtida
//       da API, para exibir ao usuário ("índice atualizado em ..."), já que
//       sem isso não há como saber se o dado usado é de agora ou de uma
//       consulta antiga feita em outra sessão.
// Não tenta ser um cache "inteligente" (sem expiração, sem revalidação
// parcial) — cada combinação (código de série + data inicial + data final)
// tem sua própria entrada; uma nova consulta com o mesmo período reaproveita
// o cache só como fallback de indisponibilidade, nunca no lugar de uma
// tentativa de buscar dado atualizado primeiro.
const CACHE_PREFIXO = 'calc_desapropriacao_cache_bcb::';
function chaveCache(codigo, dataIniIso, dataFimIso){
  return CACHE_PREFIXO + codigo + '::' + dataIniIso + '::' + dataFimIso;
}
function lerCacheSerie(chave){
  try{
    if(typeof localStorage === 'undefined') return null;
    const bruto = localStorage.getItem(chave);
    if(!bruto) return null;
    const obj = JSON.parse(bruto);
    if(!obj || !Array.isArray(obj.dados) || !obj.obtidoEm) return null;
    return obj;
  }catch(e){
    return null; // localStorage indisponível/corrompido: apenas não usa cache
  }
}
function salvarCacheSerie(chave, dados){
  try{
    if(typeof localStorage === 'undefined') return;
    localStorage.setItem(chave, JSON.stringify({ dados, obtidoEm: new Date().toISOString() }));
  }catch(e){
    // Quota excedida ou localStorage bloqueado: cache é só um reforço de
    // disponibilidade, não uma dependência — segue sem ele.
  }
}

// Busca a série do Bacen com cache local: tenta a API; se falhar, tenta o
// cache da MESMA consulta (mesmo código+período); se não houver nada em
// nenhum dos dois, propaga o erro original (quem chamou decide o fallback
// final — ex.: taxa manual).
async function buscarSerieBcbComCache(codigo, dataIniIso, dataFimIso){
  const chave = chaveCache(codigo, dataIniIso, dataFimIso);
  try{
    const dados = await buscarSerieBcb(codigo, dataIniIso, dataFimIso);
    salvarCacheSerie(chave, dados);
    return { dados, origem: 'api', obtidoEm: new Date().toISOString() };
  }catch(erroApi){
    const cache = lerCacheSerie(chave);
    if(cache){
      return { dados: cache.dados, origem: 'cache', obtidoEm: cache.obtidoEm };
    }
    throw erroApi;
  }
}

// Busca a Meta Selic vigente (taxa legal de juros) — usada no Art. 4º.
async function buscarTaxaLegalSelic(){
  const resp = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + BCB_SERIES.selicMeta + '/dados/ultimos/1?formato=json');
  if(!resp.ok) throw new Error('Falha na resposta');
  const data = await resp.json();
  if(!data || !data[0] || !data[0].valor) throw new Error('Sem dados retornados');
  const valor = parseFloat(String(data[0].valor).replace(',', '.'));
  // CORREÇÃO (prioridade crítica): parseFloat() sem validação de NaN — se a
  // API do Bacen devolvesse um "valor" em formato inesperado, essa função
  // retornava {valor: NaN} sem avisar, propagando NaN para quem a chamasse.
  // Agora trata como falha explícita da API (mesmo tratamento de qualquer
  // outra resposta malformada, já usado no restante do arquivo).
  if(!isFinite(valor)) throw new Error('Valor retornado pela API do Bacen em formato inválido');
  return { valor, data: data[0].data };
}

// Monta um mapa {competencia (mm/aaaa) -> taxa (%)} a partir da resposta do Bacen.
// CORREÇÃO (prioridade crítica): antes gravava parseFloat() direto no mapa,
// mesmo quando resultava em NaN (item.valor malformado). Quem chamava esta
// função dependia de isFinite(mapa[chave]) para detectar competência
// "faltante" — mas isso só funciona se o valor inválido nunca for gravado.
// Um NaN gravado no mapa e lido sem essa checagem em algum ponto futuro do
// código propagaria silenciosamente para toda a cadeia multiplicativa de
// correção (fatorAcumulado *= (1 + taxa/100)), contaminando o resultado final
// sem gerar erro. Agora a competência com valor inválido simplesmente não é
// gravada no mapa — o que já é tratado, em todos os pontos que consultam
// este mapa, como "índice histórico não localizado para a competência".
function indexarPorCompetencia(serieBcb){
  const mapa = {};
  serieBcb.forEach(item => {
    // item.data vem como dd/mm/aaaa; a competência é mm/aaaa.
    const partes = item.data.split('/');
    const chave = partes[1] + '/' + partes[2];
    const valor = parseFloat(String(item.valor).replace(',', '.'));
    if(isFinite(valor)) mapa[chave] = valor;
  });
  return mapa;
}

/* ------------------------------------------------------------------------
   2B. ÚLTIMA COMPETÊNCIA DISPONÍVEL DE UM ÍNDICE (atalho dos botões
   IPCA-E/Selic/IPCA — Art. 3º). Busca só o valor mais recente já divulgado
   pelo Bacen para a série do índice informado (não a série completa do
   período do cálculo — essa segue sendo buscada por montarMemoriaCorrecao,
   ao clicar em "Calcular"). Serve como conferência rápida ("o que esse
   índice está valendo agora?") no momento em que a pessoa escolhe o botão,
   antes mesmo de preencher datas/valores.
------------------------------------------------------------------------ */
async function buscarUltimaCompetenciaIndice(indiceKey){
  const codigo = BCB_SERIES[indiceKey];
  if(!codigo) throw new Error('Índice sem série BCB configurada: ' + indiceKey);
  const resp = await fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.' + codigo + '/dados/ultimos/1?formato=json');
  if(!resp.ok) throw new Error('Falha na resposta da API do Bacen (HTTP ' + resp.status + ')');
  const data = await resp.json();
  if(!data || !data[0] || data[0].valor === undefined) throw new Error('Sem dados retornados pela API do Bacen.');
  const valor = parseFloat(String(data[0].valor).replace(',', '.'));
  if(!isFinite(valor)) throw new Error('Valor retornado pela API do Bacen em formato inválido.');
  return { valor, data: data[0].data }; // data no formato dd/mm/aaaa
}

/* ------------------------------------------------------------------------
   3. MONTAGEM DA MEMÓRIA DE CORREÇÃO (mês a mês)
   Constrói a memória de cálculo da correção monetária, mês a mês, aplicando
   o índice escolhido sobre a diferença apurada (valor-base).
   Regras de tratamento de lacunas:
    - se a busca à API falhar totalmente (nenhuma resposta), usa a taxa
      manual informada (ou, na ausência desta, pede ao usuário que informe
      uma taxa) para todos os meses, sinalizando a origem como "fallback"
      (cálculo manual/estimativo, explicitamente permitido pelo usuário);
    - se a API responder mas faltar o índice histórico de uma ou mais
      competências específicas (ou faltar a Selic histórica para alguma
      competência pós-EC 113/2021, quando a troca automática está ativa),
      o cálculo oficial é BLOQUEADO — nenhuma média, estimativa ou
      aproximação automática é aplicada para preencher competência
      histórica ausente.
------------------------------------------------------------------------ */
function formatarCompetenciasFaltantes(faltantes){
  const lista = faltantes.map(f => f.competencia + ' (' + f.esperado + ')').join(', ');
  return 'Índice histórico não localizado para a(s) competência(s): ' + lista +
    '. O cálculo oficial foi bloqueado para evitar estimativa automática. ' +
    'Verifique a fonte histórica ou informe uma metodologia válida para o período.';
}
// Competência de corte da EC 113/2021 (promulgada em 08/12/2021): a partir
// da competência 12/2021, débitos da Fazenda Pública passam a ser corrigidos
// exclusivamente pela Selic (que já engloba correção monetária e juros).
const EC113_CORTE = { ano: 2021, mes: 12 };
function competenciaPosEC113(c){
  return (c.ano > EC113_CORTE.ano) || (c.ano === EC113_CORTE.ano && c.mes >= EC113_CORTE.mes);
}async function montarMemoriaCorrecao(valorBase, dataIniIso, dataFimIso, indice, taxaManual, incluirMesInicial, aplicarEC113){
  const competencias = listarCompetencias(dataIniIso, dataFimIso, incluirMesInicial);
  const memoria = [];
  const fonteInfo = { indice, obtidoEm: new Date(), modo: 'api', detalhe: '' };

  if(competencias.length === 0){
    return { memoria, fonteInfo: { ...fonteInfo, modo: 'vazio', detalhe: 'Período sem meses de incidência.' } };
  }

  // Só faz sentido "trocar" para Selic quando o índice escolhido não é a
  // própria Selic e existem competências a partir de 12/2021 no período.
  const usaSwitchEC113 = !!aplicarEC113 && indice !== 'selic' && competencias.some(competenciaPosEC113);
  // Exposto no retorno para que o cálculo de juros moratórios saiba, sem
  // duplicar esta lógica, em quais meses a correção já está sendo feita
  // pela Selic (que já embute os juros de mora) — evitando dupla incidência.
  fonteInfo.usaSwitchEC113 = usaSwitchEC113;
  fonteInfo.indiceJaEraSelic = (indice === 'selic');

  // Busca antecipada da série Selic apenas para os meses pós-EC 113/2021.
  // Se a busca falhar (mapaSelicPosEC permanece null), as validações abaixo
  // tratam isso como Selic histórica ausente para todas as competências
  // pós-corte, bloqueando o cálculo — nunca mantendo silenciosamente o
  // índice originalmente selecionado nesses meses.
  let mapaSelicPosEC = null;
  let selicEC113Origem = null; // { origem: 'api'|'cache', obtidoEm } — para exibir data de atualização
  if(usaSwitchEC113){
    try{
      const primeiraPosEC = competencias.find(competenciaPosEC113);
      const dataIniSelic = primeiraPosEC.ano + '-' + String(primeiraPosEC.mes).padStart(2,'0') + '-01';
      const r = await buscarSerieBcbComCache(BCB_SERIES.selic, dataIniSelic, dataFimIso);
      mapaSelicPosEC = indexarPorCompetencia(r.dados);
      selicEC113Origem = { origem: r.origem, obtidoEm: r.obtidoEm };
    }catch(e){
      mapaSelicPosEC = null;
    }
  }
  const fonteSelicEC113 = 'API Bacen (SGS ' + BCB_SERIES.selic + ' — Selic, EC 113/2021)';

  // Modo manual OU "conforme sentença": taxa fixa definida pelo usuário para
  // todo o período. CORREÇÃO (revisão pericial, achado 2.2/2.3): 'sentenca'
  // era tratado extensivamente pela auditoria (motor.js) e tinha um <textarea>
  // dedicado no HTML, mas o <select id="indice"> não tinha essa <option> — e,
  // se tivesse, esta função (indices.js) cairia no modo API com um código de
  // série indefinido (BCB_SERIES['sentenca'] não existe) e quebraria. Ambos
  // os lados foram corrigidos juntos: a <option> agora existe em index.html,
  // e aqui 'sentenca' segue a mesma mecânica de 'manual' (usa taxaManual como
  // taxa mensal), pois é o próprio usuário quem transcreve/confirma no campo
  // "Trecho da sentença" qual foi o índice fixado pelo juízo — a calculadora
  // não tem como extrair uma fórmula de texto livre automaticamente. A
  // diferença fica só na rotulagem (fonte "Sentença" em vez de "Manual"),
  // para deixar claro na memória de cálculo de onde veio a taxa.
  if(indice === 'manual' || indice === 'sentenca'){
    // Validação prévia: se a troca EC 113/2021 está ativa, toda competência
    // pós-EC113 precisa ter Selic histórica localizada — inclusive quando a
    // busca da Selic falhou por completo (mapaSelicPosEC nulo, e portanto
    // nenhuma competência pós-corte possui o dado). Caso contrário, o
    // cálculo é bloqueado: Selic histórica ausente nunca é substituída
    // silenciosamente pela taxa manual/base.
    if(usaSwitchEC113){
      const faltantesEC = [];
      competencias.forEach(c => {
        if(competenciaPosEC113(c)){
          const chave = competenciaLabel(c);
          if(!mapaSelicPosEC || !isFinite(mapaSelicPosEC[chave])){
            faltantesEC.push({ competencia: chave, esperado: 'Selic — EC 113/2021' });
          }
        }
      });
      if(faltantesEC.length > 0){
        throw new Error(formatarCompetenciasFaltantes(faltantesEC));
      }
    }
    const ehSentenca = indice === 'sentenca';
    fonteInfo.modo = ehSentenca ? 'sentenca' : 'manual';
    fonteInfo.detalhe = (ehSentenca
      ? 'Taxa aplicada conforme o índice fixado na sentença/título (confira o trecho transcrito abaixo contra o valor informado em "Taxa manual").'
      : 'Taxa informada manualmente pelo usuário.') +
      (usaSwitchEC113 ? ' A partir de 12/2021, aplicada automaticamente a Selic (EC 113/2021).' : '');
    let acumulado = 1;
    competencias.forEach(c => {
      const chave = competenciaLabel(c);
      let taxa = taxaManual;
      let fonte = ehSentenca ? 'Conforme sentença' : 'Manual';
      if(usaSwitchEC113 && mapaSelicPosEC && competenciaPosEC113(c) && isFinite(mapaSelicPosEC[chave])){
        taxa = mapaSelicPosEC[chave];
        fonte = fonteSelicEC113;
      }
      acumulado *= (1 + taxa / 100);
      memoria.push({
        competencia: chave, taxa, fatorMensal: 1 + taxa/100,
        fatorAcumulado: acumulado, valorCorrigido: valorBase * acumulado,
        fonte, estimado: false
      });
    });
    return { memoria, fonteInfo };
  }

  // Modo API (Selic / IPCA / IPCA-E / INPC): busca a série no Bacen, com
  // cache local (ver buscarSerieBcbComCache) — se a API estiver fora do ar
  // mas já existir uma série cacheada para este mesmo período (de uma
  // consulta anterior bem-sucedida), ela é usada em vez de já partir para
  // o fallback com taxa manual, e a memória de cálculo sinaliza que os
  // dados vieram do cache (com a data em que foram obtidos originalmente).
  let mapaTaxas = null;
  let origemIndicePrincipal = null;
  try{
    const codigo = BCB_SERIES[indice];
    const r = await buscarSerieBcbComCache(codigo, dataIniIso, dataFimIso);
    mapaTaxas = indexarPorCompetencia(r.dados);
    origemIndicePrincipal = { origem: r.origem, obtidoEm: r.obtidoEm };
    if(Object.keys(mapaTaxas).length === 0) throw new Error('API retornou sem dados para o período');
  }catch(err){
    // Fallback total: API indisponível E sem nada em cache para este período.
    if(!(taxaManual > 0)){
      throw new Error('API do Bacen indisponível (e nenhuma consulta anterior deste período está em cache) e nenhuma taxa personalizada foi informada como alternativa. Informe uma taxa em "Personalizado" para permitir o cálculo offline.');
    }
    // Mesma validação: se a troca EC113 está ativa, a Selic histórica é
    // obrigatória para as competências pós-corte — inclusive quando a busca
    // da Selic falhou por completo (mapaSelicPosEC nulo). O índice principal
    // ter falhado (o que já ativou este fallback com taxa manual) não
    // dispensa a exigência de Selic histórica para esses meses.
    if(usaSwitchEC113){
      const faltantesEC = [];
      competencias.forEach(c => {
        if(competenciaPosEC113(c)){
          const chave = competenciaLabel(c);
          if(!mapaSelicPosEC || !isFinite(mapaSelicPosEC[chave])){
            faltantesEC.push({ competencia: chave, esperado: 'Selic — EC 113/2021' });
          }
        }
      });
      if(faltantesEC.length > 0){
        throw new Error(formatarCompetenciasFaltantes(faltantesEC));
      }
    }
    fonteInfo.modo = 'fallback-total';
    fonteInfo.detalhe = 'API do Bacen indisponível (sem cache local para este período) — usada a taxa personalizada informada, aplicada uniformemente ao período.';
    let acumulado = 1;
    competencias.forEach(c => {
      const chave = competenciaLabel(c);
      let taxa = taxaManual;
      let fonte = 'Fallback (API indisponível)';
      if(usaSwitchEC113 && mapaSelicPosEC && competenciaPosEC113(c) && isFinite(mapaSelicPosEC[chave])){
        taxa = mapaSelicPosEC[chave];
        fonte = fonteSelicEC113;
      }
      acumulado *= (1 + taxa / 100);
      memoria.push({
        competencia: chave, taxa, fatorMensal: 1 + taxa/100,
        fatorAcumulado: acumulado, valorCorrigido: valorBase * acumulado,
        fonte, estimado: fonte.indexOf('Fallback') === 0
      });
    });
    return { memoria, fonteInfo };
  }

  // API respondeu: monta a memória mês a mês. Nenhuma lacuna pontual é
  // preenchida por média, estimativa ou aproximação — se faltar o índice
  // histórico de qualquer competência necessária (ou a Selic histórica,
  // quando a troca EC 113/2021 está ativa para aquele mês), o cálculo
  // oficial é bloqueado antes de montar a memória.
  const nomeIndiceApi = 'API Bacen (SGS ' + BCB_SERIES[indice] + ')';
  const faltantes = [];
  competencias.forEach(c => {
    const chave = competenciaLabel(c);
    if(usaSwitchEC113 && competenciaPosEC113(c)){
      const temSelic = mapaSelicPosEC && isFinite(mapaSelicPosEC[chave]);
      if(!temSelic){
        faltantes.push({ competencia: chave, esperado: 'Selic — EC 113/2021' });
      }
    }else{
      if(!isFinite(mapaTaxas[chave])){
        faltantes.push({ competencia: chave, esperado: nomeIndiceApi });
      }
    }
  });

  if(faltantes.length > 0){
    throw new Error(formatarCompetenciasFaltantes(faltantes));
  }

  let acumulado = 1;
  competencias.forEach(c => {
    const chave = competenciaLabel(c);
    let taxa, fonte;
    if(usaSwitchEC113 && competenciaPosEC113(c)){
      taxa = mapaSelicPosEC[chave];
      fonte = fonteSelicEC113;
    }else{
      taxa = mapaTaxas[chave];
      fonte = nomeIndiceApi;
    }
    acumulado *= (1 + taxa / 100);
    memoria.push({
      competencia: chave, taxa, fatorMensal: 1 + taxa/100,
      fatorAcumulado: acumulado, valorCorrigido: valorBase * acumulado,
      fonte, estimado: false
    });
  });

  fonteInfo.detalhe = 'Série obtida integralmente da API do Bacen (SGS ' + BCB_SERIES[indice] + ').';
  if(origemIndicePrincipal && origemIndicePrincipal.origem === 'cache'){
    fonteInfo.detalhe = 'API do Bacen indisponível no momento — usada a última série deste mesmo período já obtida com sucesso e guardada em cache local.';
  }
  if(usaSwitchEC113){
    fonteInfo.detalhe += ' A partir de 12/2021, aplicada automaticamente a Selic (EC 113/2021).';
    if(selicEC113Origem && selicEC113Origem.origem === 'cache'){
      fonteInfo.detalhe += ' (Selic da EC 113/2021 também obtida do cache local, não da API ao vivo.)';
    }
  }
  // CORREÇÃO (checklist — prioridade ALTA): registra quando a série usada
  // foi de fato obtida do Bacen, para exibir na tela ("índice atualizado
  // em ..."). Quando há duas origens (índice principal + Selic da EC113),
  // usa a mais antiga das duas, por ser a mais conservadora para avisar o
  // usuário sobre possível defasagem do dado.
  const origensValidas = [origemIndicePrincipal, selicEC113Origem].filter(Boolean);
  if(origensValidas.length > 0){
    fonteInfo.ultimaAtualizacao = origensValidas
      .map(o => o.obtidoEm)
      .sort()[0];
    fonteInfo.deCache = origensValidas.some(o => o.origem === 'cache');
  }

  return { memoria, fonteInfo };
}
