/* ============================================================================
   INTELIGENCIAJURIDICA.JS — Fase 5 do checklist.

   Recebe os campos já extraídos por classificadorExtrator.js (regex +
   proximidade) e aplica um segundo nível de leitura, mais "de conteúdo":
     - identificar qual valor é de fato a indenização final (não a oferta,
       nem o depósito, nem o valor pericial — que servem de referência mas
       não são o resultado);
     - se houver acórdão nas páginas, verificar se ele reformou a sentença
       e, se sim, priorizar o valor do acórdão;
     - registrar como alerta (não decide sozinho) quando o índice de
       correção do processo ficou ambíguo (mais de um índice mencionado).

   Este arquivo NUNCA sobrescreve um campo com confiança mais alta por um de
   confiança mais baixa — só ajusta a fonte/confiança quando encontra um
   sinal jurídico mais específico do que a extração bruta já tinha.
   Tudo aqui é heurística de apoio à conferência humana (Fase 6), não uma
   decisão automática definitiva.
============================================================================ */

function aplicarInteligenciaJuridica(campos, paginas){
  detectarTipoAcaoDesapropriacao(campos, paginas);
  detectarReformaAcordao(campos, paginas);
  sinalizarIndiceAmbiguo(campos, paginas);
  detectarSugestaoEC113(campos, paginas);
  distinguirValoresDeReferencia(campos);
  inferirOfertaDoDeposito(campos);
  validarDatas(campos);
  detectarDuplicidadesDeValor(campos, paginas);
  return campos;
}

/* ------------------------------------------------------------------------
   7. SUGESTÃO DE TROCA PARA SELIC (EC 113/2021) — Fase 2 do checklist
   ("...selecionar automaticamente o tipo de cálculo e o índice na maioria
   dos casos").

   A Emenda Constitucional 113/2021 substituiu, a partir de dezembro/2021,
   os índices de correção monetária e juros da Fazenda Pública pela taxa
   Selic (que já embute os dois). O formulário já tem uma checkbox própria
   para isso (#aplicarEC113, "Trocar para Selic a partir de 12/2021"), que
   motor.js consome — este detector só procura, nas peças, menção explícita
   à EC 113/2021 ou à troca para Selic a partir de dez/2021, e SUGERE marcar
   a checkbox (nunca marca sozinho: o campo entra na conferência da Fase 6
   como qualquer outro, e só é aplicado se o advogado clicar em "Preencher
   formulário"). Não desmarca a checkbox se não encontrar nada — silêncio
   aqui significa "sem evidência", não "não se aplica".
------------------------------------------------------------------------ */
function detectarSugestaoEC113(campos, paginas){
  const ancorasEC113 = [
    /emenda\s+constitucional\s*n?[ºo°.]?\s*113\/?\s*2021/i,
    /\bec\s*(?:n?[ºo°.]?\s*)?113\/?2021\b/i,
    /taxa\s+selic.{0,50}(?:a\s+partir\s+de|desde)\s+dezembro\s+de\s+2021/i,
    /substitui[çc][ãa]o\s+(?:do\s+[íi]ndice\s+de\s+corre[çc][ãa]o\s+)?pela\s+taxa\s+selic/i
  ];
  const paginasRelevantes = paginasDoTipo(paginas, 'sentenca', 'acordao');
  const alvo = paginasRelevantes.length ? paginasRelevantes : paginas;

  for(const p of alvo){
    for(const ancora of ancorasEC113){
      const m = ancora.exec(p.texto || '');
      if(m){
        campos.aplicarEC113 = {
          valor: true,
          confianca: 0.65,
          pagina: p,
          trecho: contexto(p.texto, m.index, 70),
          observacao: 'As peças mencionam a Emenda Constitucional 113/2021 (troca do índice de correção/juros para a taxa Selic a partir de dezembro de 2021). Confirme se a regra se aplica ao período do seu cálculo antes de marcar.'
        };
        return;
      }
    }
  }
}

/* ------------------------------------------------------------------------
   0. DETECÇÃO AUTOMÁTICA: DESAPROPRIAÇÃO DIRETA x INDIRETA (Fase 2 do
   checklist de Inteligência Jurídica)

   A distinção não é uma questão de vocabulário isolado, mas do RITO: na
   direta (DL 3.365/41) é o Poder Público quem ajuíza a ação, normalmente
   precedida de decreto expropriatório/declaração de utilidade pública e
   com depósito prévio para imissão na posse ANTES da sentença. Na indireta,
   o Poder Público já ocupou o bem de fato (apossamento administrativo/
   esbulho) e é o PARTICULAR quem ajuíza a ação pedindo indenização, sem
   processo formal de desapropriação por trás.

   Por isso a detecção usa duas listas de marcadores textuais com peso —
   marcadores mais específicos (ex.: a própria expressão "desapropriação
   indireta") pesam mais que sinais indiretos (ex.: só "imissão provisória
   na posse", que também aparece, com outro sentido, em ações possessórias
   comuns). Soma-se o peso por tipo em todas as páginas do processo e só se
   decide por um lado quando a diferença entre os placares é relevante —
   caso contrário, fica em aberto (ambos aparecem, ou nenhum aparece) e o
   advogado decide manualmente, no mesmo espírito das demais heurísticas
   deste arquivo: sugestão para conferência (Fase 6), nunca decisão
   automática definitiva. O campo produzido (`tipoAcaoDetectado`) segue o
   mesmo formato {valor, confianca, pagina, trecho, observacao} dos demais
   campos, o que permite reaproveitar toda a infraestrutura de conferência/
   preenchimento já existente em painelConferencia.js.
------------------------------------------------------------------------ */
const MARCADORES_TIPO_ACAO = {
  // Desapropriação DIRETA — <option value="desapropriacao"> no formulário.
  desapropriacao: [
    { re: /desapropria[çc][ãa]o direta/i, peso: 3 },
    { re: /decreto\s+expropriat[óo]rio/i, peso: 2 },
    { re: /decreto\s+de\s+utilidade\s+p[úu]blica/i, peso: 2 },
    { re: /declara[çc][ãa]o\s+de\s+utilidade\s+p[úu]blica/i, peso: 2 },
    { re: /decreto\s+de\s+interesse\s+social(?:\s+para\s+fins\s+de\s+reforma\s+agr[áa]ria)?/i, peso: 2 },
    { re: /decreto[\s-]?lei\s*n?[ºo°.]?\s*3\.?365/i, peso: 2 },
    { re: /lei\s*n?[ºo°.]?\s*4\.?132/i, peso: 2 }, // desapropriação por interesse social
    { re: /dep[óo]sito\s+pr[ée]vio/i, peso: 1 },
    { re: /imiss[ãa]o\s+provis[óo]ria\s+na\s+posse/i, peso: 1 }
  ],
  // Desapropriação INDIRETA — <option value="indenizacao"> no formulário.
  indenizacao: [
    { re: /desapropria[çc][ãa]o\s+indireta/i, peso: 3 },
    { re: /apossamento\s+administrativo/i, peso: 3 },
    { re: /a[çc][ãa]o\s+indenizat[óo]ria\s+por\s+(?:desapropria[çc][ãa]o\s+indireta|apossamento)/i, peso: 3 },
    { re: /esbulho\s+(?:administrativo|possess[óo]rio\s+praticado\s+pelo\s+poder\s+p[úu]blico)/i, peso: 2 },
    { re: /ocupa[çc][ãa]o\s+de\s+fato(?:\s+pelo\s+poder\s+p[úu]blico)?/i, peso: 1 },
    { re: /sem\s+(?:pr[ée]via\s+)?(?:processo\s+formal\s+de\s+desapropria[çc][ãa]o|declara[çc][ãa]o\s+de\s+utilidade\s+p[úu]blica)/i, peso: 1 },
    { re: /s[úu]mula\s+119\s+do\s+stj/i, peso: 1 } // prazo prescricional de desapropriação indireta
  ]
};

const ROTULOS_TIPO_ACAO = { desapropriacao: 'direta', indenizacao: 'indireta' };

// Diferença mínima de pontuação entre os dois lados para a detecção se
// arriscar a apontar um tipo — abaixo disso, fica ambíguo/indefinido de
// propósito, em vez de "chutar" o lado que só ganhou por um marcador fraco.
const LIMIAR_DIFERENCA_TIPO_ACAO = 2;

function detectarTipoAcaoDesapropriacao(campos, paginas){
  const placares = { desapropriacao: 0, indenizacao: 0 };
  const evidencias = { desapropriacao: [], indenizacao: [] };

  paginas.forEach(p => {
    const texto = p.texto || '';
    Object.keys(MARCADORES_TIPO_ACAO).forEach(tipo => {
      MARCADORES_TIPO_ACAO[tipo].forEach(({ re, peso }) => {
        const m = re.exec(texto);
        if(m){
          placares[tipo] += peso;
          if(evidencias[tipo].length < 3){
            evidencias[tipo].push({ pagina: p, trecho: contexto(texto, m.index, 60) });
          }
        }
      });
    });
  });

  const { desapropriacao: pontosDireta, indenizacao: pontosIndireta } = placares;
  if(pontosDireta === 0 && pontosIndireta === 0) return; // nenhum marcador — não há o que sugerir

  const diferenca = Math.abs(pontosDireta - pontosIndireta);
  if(diferenca < LIMIAR_DIFERENCA_TIPO_ACAO){
    // Só alerta como "ambíguo" quando os DOIS lados têm sinal (é isso que
    // torna o caso ambíguo). Se só um lado tem pontos mas ainda abaixo do
    // limiar (ex.: um único marcador fraco, tipo só "imissão provisória na
    // posse" sozinho), o outro lado está em zero — não é ambiguidade, é
    // evidência insuficiente para decidir; melhor ficar em silêncio do que
    // soar um alarme sobre um empate que não existe.
    if(pontosDireta > 0 && pontosIndireta > 0){
      campos._alertaTipoAcaoAmbiguo = {
        mensagem: `Não foi possível determinar com segurança se o processo é desapropriação direta ou indireta (sinais de ambas apareceram nas peças, sem um lado claramente predominante). Confirme manualmente o campo "Tipo de ação".`
      };
    }
    return;
  }

  const vencedor = pontosDireta > pontosIndireta ? 'desapropriacao' : 'indenizacao';
  const pontosVencedor = Math.max(pontosDireta, pontosIndireta);
  // Confiança proporcional à força do sinal (marcador de 3 pontos sozinho já
  // basta para decidir, mas com confiança moderada; múltiplos marcadores
  // concordantes elevam a confiança, com teto de 0.75 — a mesma cautela dos
  // demais campos deste arquivo, que nunca chegam a 1.0 porque dependem de
  // leitura de OCR e de um recorte textual, não de certeza jurídica).
  const confianca = Math.min(0.75, 0.4 + pontosVencedor * 0.05);
  const primeiraEvidencia = evidencias[vencedor][0];

  campos.tipoAcaoDetectado = {
    valor: vencedor,
    confianca,
    pagina: primeiraEvidencia ? primeiraEvidencia.pagina : null,
    trecho: primeiraEvidencia ? primeiraEvidencia.trecho : '',
    observacao: `Detectado como desapropriação ${ROTULOS_TIPO_ACAO[vencedor]} por marcadores textuais nas peças (${evidencias[vencedor].length} trecho(s) identificado(s)). Confirme antes de preencher — esta sugestão nunca substitui a leitura do processo pelo advogado.`
  };
}

/* ------------------------------------------------------------------------
   5. VALIDAÇÃO LÓGICA DE DATAS (Prioridade 1 do checklist)
   parseDataBRParaIso() já garante formato válido (dia/mês dentro do range).
   Aqui vai além do formato: checa se a data faz sentido no tempo —
   nenhuma data extraída pode estar no futuro, e a ordem cronológica básica
   do processo (oferta -> depósito -> sentença) precisa ser plausível.
   Isso NUNCA apaga a data; só reduz a confiança e explica o motivo, para o
   advogado decidir na conferência (Fase 6).
------------------------------------------------------------------------ */
function validarDatas(campos){
  const hojeIso = new Date().toISOString().slice(0, 10);
  const alertas = [];

  ['dataOferta', 'dataSentenca', 'dataImissao', 'depositoData'].forEach(id => {
    const c = campos[id];
    if(c && c.valor && c.valor > hojeIso){
      alertas.push(`A data de "${id}" (${formatarDataIsoParaBR(c.valor)}) está no futuro — provável erro de leitura (dia/mês invertido ou falha de OCR).`);
      c.confianca = Math.min(c.confianca, 0.2);
      c.observacao = (c.observacao ? c.observacao + ' ' : '') + 'Data futura detectada — confira manualmente.';
    }
  });

  if(campos.dataOferta && campos.dataSentenca && campos.dataOferta.valor && campos.dataSentenca.valor
     && campos.dataSentenca.valor < campos.dataOferta.valor){
    alertas.push(`A data da sentença (${formatarDataIsoParaBR(campos.dataSentenca.valor)}) é anterior à data da oferta (${formatarDataIsoParaBR(campos.dataOferta.valor)}) — ordem cronológica improvável.`);
    campos.dataSentenca.confianca = Math.min(campos.dataSentenca.confianca, 0.3);
    campos.dataOferta.confianca = Math.min(campos.dataOferta.confianca, 0.3);
    campos.dataSentenca.observacao = (campos.dataSentenca.observacao ? campos.dataSentenca.observacao + ' ' : '') + 'Anterior à data da oferta — confira.';
  }

  if(campos.depositoData && campos.dataOferta && campos.depositoData.valor && campos.dataOferta.valor
     && campos.depositoData.valor < campos.dataOferta.valor){
    alertas.push(`A data do depósito judicial (${formatarDataIsoParaBR(campos.depositoData.valor)}) é anterior à data da oferta (${formatarDataIsoParaBR(campos.dataOferta.valor)}) — o depósito costuma ser posterior ou concomitante à oferta.`);
    campos.depositoData.confianca = Math.min(campos.depositoData.confianca, 0.3);
    campos.depositoData.observacao = (campos.depositoData.observacao ? campos.depositoData.observacao + ' ' : '') + 'Anterior à data da oferta — confira.';
  }

  if(alertas.length) campos._alertaDatas = { mensagem: alertas.join(' ') };
}

/* ------------------------------------------------------------------------
   6. DUPLICIDADE / DIVERGÊNCIA DE VALORES ENTRE PÁGINAS
   classificadorExtrator.js pega o PRIMEIRO valor que casa com cada âncora.
   Isso é bom para velocidade, mas esconde o caso em que duas páginas
   diferentes mencionam valores diferentes para o "mesmo" campo (ex.: valor
   da indenização difere entre um resumo e a sentença propriamente dita).
   Aqui varremos de novo as mesmas páginas-alvo com buscarTodosProximos()
   para achar candidatos alternativos; se algum valor DISTINTO do já
   escolhido aparecer em outra página, isso é sinalizado como possível
   duplicidade/divergência — a confiança cai e o valor não é trocado
   automaticamente (a escolha de qual está certo é do advogado).
------------------------------------------------------------------------ */
function detectarDuplicidadesDeValor(campos, paginas){
  const paginasSentenca = paginasDoTipo(paginas, 'sentenca', 'acordao');
  const paginasLaudo = paginasDoTipo(paginas, 'laudoPericial');
  const paginasDeposito = paginasDoTipo(paginas, 'depositoJudicial');

  const especificacoes = [
    { id: 'valorOferta', paginasAlvo: paginas, anchors: [/oferta(?:\s+administrativa|\s+inicial)?/i], janela: 120 },
    { id: 'valorSentenca', paginasAlvo: paginasSentenca.length ? paginasSentenca : paginas, anchors: [
        /fixo a indenização em/i, /condeno .{0,40} ao pagamento de/i, /valor da indenização/i,
        /arbitro o valor da indenização em/i, /indeniza[çc][ãa]o .{0,20}(?:foi )?fixada em/i,
        /indeniza[çc][ãa]o .{0,20}arbitrada em/i
      ], janela: 100 },
    { id: 'valorPericial', paginasAlvo: paginasLaudo, anchors: [/valor (?:da )?(?:indenização|avaliação)/i, /concluiu .{0,20}(?:indenização|avaliação) de/i], janela: 100 },
    { id: 'depositoValor', paginasAlvo: paginasDeposito, anchors: [/dep[óo]sito(?: judicial)?/i], janela: 100 }
  ];

  especificacoes.forEach(({ id, paginasAlvo, anchors, janela }) => {
    const campo = campos[id];
    if(!campo || campo.valor === null || campo.valor === undefined) return;

    const candidatos = [];
    (paginasAlvo || []).forEach(p => {
      anchors.forEach(ancora => {
        buscarTodosProximos(p.texto || '', ancora, REGEX_VALOR_RS, janela).forEach(r => {
          const v = parseValorMoedaBR(r.valorBruto);
          if(v !== null) candidatos.push({ valor: v, pagina: p, trecho: r.trecho });
        });
      });
    });

    const valorPrincipal = Math.round(campo.valor * 100);
    // Se valorSentenca acabou de ser trocado pelo valor do acórdão
    // (detectarReformaAcordao, que roda antes deste detector), o valor
    // antigo da sentença de 1º grau volta a aparecer aqui como "candidato
    // divergente" — mas isso não é uma duplicidade em aberto, é justamente
    // o valor que o próprio sistema já identificou e explicou como
    // superado pela reforma. Não sinaliza de novo pedindo para "confirmar
    // qual é o correto" quando isso já foi respondido.
    const valorAnteriorConhecido = (id === 'valorSentenca' && campos._valorSentencaAnterior)
      ? Math.round(campos._valorSentencaAnterior.valor * 100)
      : null;

    const alternativos = new Map();
    candidatos.forEach(c => {
      const chave = Math.round(c.valor * 100);
      if(chave === valorPrincipal) return; // mesmo valor achado de novo — corroboração, não duplicidade
      if(chave === valorAnteriorConhecido) return; // já explicado pela reforma do acórdão, não é duplicidade
      if(!alternativos.has(chave)) alternativos.set(chave, { valor: c.valor, ocorrencias: [] });
      alternativos.get(chave).ocorrencias.push({ pagina: c.pagina, trecho: c.trecho });
    });

    if(alternativos.size){
      const lista = Array.from(alternativos.values());
      const resumo = lista.map(a => `${formatarValorParaCampoMoeda(a.valor)} (${a.ocorrencias.length}x)`).join('; ');
      campo.duplicidade = { valorPrincipal: campo.valor, alternativos: lista };
      campo.confianca = Math.min(campo.confianca, 0.35);
      campo.observacao = (campo.observacao ? campo.observacao + ' ' : '') +
        `Possível duplicidade: outro(s) valor(es) para este campo aparece(m) em outra(s) página(s) — ${resumo}. Confirme qual é o correto.`;
      if(!campos._alertasDuplicidadeValor) campos._alertasDuplicidadeValor = [];
      campos._alertasDuplicidadeValor.push(`Campo "${id}": além de ${formatarValorParaCampoMoeda(campo.valor)}, foi encontrado ${resumo} em outra(s) página(s).`);
    }
  });
}

/* ------------------------------------------------------------------------
   1. REFORMA DE SENTENÇA EM ACÓRDÃO
   Se há página de acórdão com termos de provimento e um valor de R$ logo
   depois, isso é jurisprudencialmente mais atual que o valor da sentença de
   1º grau — prioriza como valorSentenca (o formulário usa esse campo como
   "valor do título" independente da instância) e explica a troca no trecho.
------------------------------------------------------------------------ */
function detectarReformaAcordao(campos, paginas){
  const paginasAcordao = paginasDoTipo(paginas, 'acordao');
  if(!paginasAcordao.length) return;

  const padroesProvimento = [/dou provimento/i, /dá-se provimento/i, /reformo a sentença/i, /para fixar a indenização em/i];

  for(const p of paginasAcordao){
    const foiProvido = padroesProvimento.some(re => re.test(p.texto || ''));
    if(!foiProvido) continue;

    const r = buscarProximo(p.texto || '', /(?:para fixar a indenização em|passa a ser de)/i, REGEX_VALOR_RS, 100);
    if(r){
      const novoValor = parseValorMoedaBR(r.valorBruto);
      if(novoValor !== null){
        // Guarda o valor de 1º grau que está sendo substituído — é ele que
        // vai reaparecer nas páginas da sentença quando
        // detectarDuplicidadesDeValor varrer os anchors de novo, e sem essa
        // referência o sistema acaba se contradizendo: sinaliza o valor
        // antigo como "possível duplicidade, confirme qual é o correto"
        // mesmo já sabendo, aqui, que foi superado pelo acórdão.
        if(campos.valorSentenca && campos.valorSentenca.valor !== novoValor){
          campos._valorSentencaAnterior = {
            valor: campos.valorSentenca.valor,
            pagina: campos.valorSentenca.pagina,
            trecho: campos.valorSentenca.trecho
          };
        }
        campos.valorSentenca = {
          valor: novoValor,
          confianca: 0.7,
          pagina: p,
          trecho: r.trecho,
          observacao: 'Substituído pelo valor do acórdão — sentença de 1º grau parece ter sido reformada.'
        };
      }
    } else {
      // Não achou o novo valor explícito, mas sinaliza a reforma para o
      // advogado conferir manualmente, sem tocar no valor já extraído.
      campos._alertaReforma = {
        mensagem: 'O acórdão parece dar provimento ao recurso (termos de reforma encontrados), mas não foi possível localizar automaticamente o novo valor da indenização — confira manualmente.',
        pagina: p
      };
    }
    break;
  }
}

/* ------------------------------------------------------------------------
   2. ÍNDICE DE CORREÇÃO AMBÍGUO
   Se mais de um índice (IPCA, IPCA-E, INPC, Selic) aparece nas páginas
   classificadas como sentença/acórdão, marca como ambíguo em vez de
   escolher um dos dois "no escuro" — quem decide é o advogado na
   conferência (Fase 6).

   EXCEÇÃO — transição explícita da EC 113/2021: a sentença dizer "IPCA-E
   até 30/11/2021 e Selic a partir de 01/12/2021" não é uma ambiguidade
   entre índices concorrentes — é a própria regra de transição da Emenda
   Constitucional 113/2021 (que substituiu juros/correção da Fazenda
   Pública pela Selic a partir de dez/2021), descrita corretamente. Como
   esse texto é praticamente padrão em sentenças de desapropriação
   pós-2021 (e o sistema já reconhece isso em detectarSugestaoEC113), não
   faz sentido tratar IPCA-E e Selic como conflitantes quando a peça cita
   a EC 113/2021 ao lado dos dois. Nesse caso, o par IPCA-E/Selic é
   removido do cômputo de "índices em conflito" — mas qualquer outro
   índice adicional (ex.: INPC aparecendo também) ainda conta e mantém o
   alerta, porque aí sim há algo além da transição já explicada.
------------------------------------------------------------------------ */
function sinalizarIndiceAmbiguo(campos, paginas){
  const paginasRelevantes = paginasDoTipo(paginas, 'sentenca', 'acordao');
  const encontrados = new Set();
  const alvo = paginasRelevantes.length ? paginasRelevantes : paginas;
  let transicaoExplicadaEC113 = false;

  for(const p of alvo){
    const texto = (p.texto || '').toLowerCase();
    if(/ipca-e|ipcae/.test(texto)) encontrados.add('IPCA-E');
    if(/\binpc\b/.test(texto)) encontrados.add('INPC');
    if(/\bipca\b/.test(texto) && !/ipca-e/.test(texto)) encontrados.add('IPCA');
    if(/\bselic\b/.test(texto)) encontrados.add('Selic');

    if(/ipca-e|ipcae/.test(texto) && /\bselic\b/.test(texto) &&
       /113\/?\s*2021/i.test(texto)){
      transicaoExplicadaEC113 = true;
    }
  }

  const encontradosParaAlerta = new Set(encontrados);
  if(transicaoExplicadaEC113){
    encontradosParaAlerta.delete('IPCA-E');
    encontradosParaAlerta.delete('Selic');
  }

  if(encontradosParaAlerta.size > 1){
    campos._alertaIndiceAmbiguo = {
      mensagem: `Mais de um índice de correção foi mencionado nas peças (${Array.from(encontrados).join(', ')}). Confirme qual se aplica antes de calcular.`
    };
    if(campos.indice) campos.indice.confianca = Math.min(campos.indice.confianca, 0.35);
  }
}

/* ------------------------------------------------------------------------
   3. NÃO CONFUNDIR OFERTA / DEPÓSITO / LAUDO PERICIAL COM A INDENIZAÇÃO
   A extração bruta já separa esses campos (valorOferta, depositoValor,
   valorPericial, valorSentenca) em classificadorExtrator.js. Aqui só
   reforçamos: se por algum motivo valorSentenca não foi encontrado mas
   valorPericial foi, NÃO promovemos o valor pericial a valorSentenca
   automaticamente — laudo pericial é referência técnica, não o título que
   define a indenização (que só vem de sentença/acórdão/acordo homologado).
   Em vez disso, deixamos valorSentenca pendente e sinalizamos a referência
   disponível, para o advogado decidir na conferência.
------------------------------------------------------------------------ */
function distinguirValoresDeReferencia(campos){
  if(!campos.valorSentenca && campos.valorPericial){
    campos._alertaValorPericialDisponivel = {
      mensagem: 'Não foi localizado o valor da indenização em sentença/acórdão, mas há um valor de laudo pericial disponível como referência (não preenchido automaticamente — o laudo é prova técnica, não o título que fixa a indenização).'
    };
  }
}

/* ------------------------------------------------------------------------
   4. OFERTA NÃO MENCIONADA EXPLICITAMENTE, MAS HÁ DEPÓSITO JUDICIAL
   Em desapropriação direta (DL 3.365/41), o depósito prévio costuma ter o
   mesmo valor da oferta administrativa/inicial — mas são conceitos
   juridicamente distintos, então nunca promovemos um pelo outro com
   confiança alta. Se a palavra "oferta" não apareceu em lugar nenhum das
   peças mas há um valor de depósito extraído, preenchemos valorOferta com
   esse valor, com confiança baixa e observação explícita: o advogado
   confirma na conferência (Fase 6) se de fato coincidem neste processo.
------------------------------------------------------------------------ */
function inferirOfertaDoDeposito(campos){
  if(!campos.valorOferta && campos.depositoValor){
    campos.valorOferta = {
      valor: campos.depositoValor.valor,
      confianca: 0.35,
      pagina: campos.depositoValor.pagina,
      trecho: campos.depositoValor.trecho,
      observacao: 'Inferido do depósito judicial inicial — a palavra "oferta" não foi encontrada nas peças. Depósito e oferta costumam ter o mesmo valor no rito do DL 3.365/41, mas são conceitos distintos; confirme antes de usar.'
    };
  }
}
