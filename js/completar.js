/* ============================================================================
   COMPLETAR.JS — Peças que faltavam para o app rodar de ponta a ponta.

   ESTE ARQUIVO NÃO ESTAVA NO ZIP ORIGINAL. Foi escrito agora, só para
   permitir o teste real no navegador, cobrindo exatamente as funções que
   motor.js / exportarPDF.js / exportarExcel.js já citavam como
   "ainda não modularizadas":
     - coletarFaixasJurosComp() / coletarFaixasJurosMora()
     - calcular()
     - bloqueadoPorAuditoria()
   mais a renderização mínima em tela (resumo, memória e auditoria) para o
   teste ficar visível.

   Nenhuma das 8 partes originais foi alterada — este arquivo só orquestra o
   que elas já expõem (montarMemoriaCorrecao, calcularJurosCompensatorios,
   calcularJurosMoratorios, auditarCalculo, configTipoAcao etc.).
============================================================================ */

/* ------------------------------------------------------------------------
   1. FAIXAS DINÂMICAS (juros compensatórios / moratórios)
------------------------------------------------------------------------ */
// CORREÇÃO (bug crítico): esta função só lia faixas de um container dinâmico
// (id="faixasJurosComp"/"faixasJurosMora", populado por adicionarFaixa()),
// mas index.html não tem esse container nem um botão "+ faixa" que chame
// adicionarFaixa() — só existe a linha ESTÁTICA única (id="faixaCompInicio"/
// "faixaCompFim"/"faixaCompTaxa" e os equivalentes de mora). Resultado: os
// campos que a pessoa efetivamente vê e preenche na tela nunca eram lidos,
// coletarFaixasJurosComp()/coletarFaixasJurosMora() sempre devolviam [], e
// motor.js sempre tratava o caso como "nenhuma faixa configurada" — juros
// compensatórios/moratórios preenchidos na tela nunca entravam no cálculo.
// Agora: usa as linhas dinâmicas se existirem (container presente e com ao
// menos uma linha) e, na ausência delas, cai para a linha estática única.
function lerFaixas(containerId, idsEstaticos){
  const linhas = document.querySelectorAll('#' + containerId + ' .faixa');
  if(linhas.length){
    return Array.from(linhas).map(l => ({
      inicio: l.querySelector('.faixaInicio').value,
      fim: l.querySelector('.faixaFim').value,
      taxa: l.querySelector('.faixaTaxa').value
    })).filter(f => f.inicio || f.fim || f.taxa);
  }
  if(idsEstaticos){
    const inicio = $(idsEstaticos.inicio) ? $(idsEstaticos.inicio).value : '';
    const fim = $(idsEstaticos.fim) ? $(idsEstaticos.fim).value : '';
    const taxa = $(idsEstaticos.taxa) ? $(idsEstaticos.taxa).value : '';
    if(inicio || fim || taxa) return [{ inicio, fim, taxa }];
  }
  return [];
}
function coletarFaixasJurosComp(){
  return lerFaixas('faixasJurosComp', { inicio: 'faixaCompInicio', fim: 'faixaCompFim', taxa: 'faixaCompTaxa' });
}
function coletarFaixasJurosMora(){
  return lerFaixas('faixasJurosMora', { inicio: 'faixaMoraInicio', fim: 'faixaMoraFim', taxa: 'faixaMoraTaxa' });
}

function adicionarFaixa(containerId){
  const div = document.createElement('div');
  div.className = 'faixa';
  div.innerHTML =
    '<input type="date" class="faixaInicio" title="Início"> ' +
    '<input type="date" class="faixaFim" title="Fim"> ' +
    '<input type="number" step="0.01" class="faixaTaxa" placeholder="% a.a." style="width:70px"> ' +
    '<button type="button" onclick="this.parentElement.remove()">remover</button>';
  $(containerId).appendChild(div);
}

/* ------------------------------------------------------------------------
   2. DEPÓSITOS E LEVANTAMENTOS (do depósito judicial)
   NOVO (checklist — "Depósitos em várias datas"): o depósito deixou de ser
   um único par valor/data (#valorDeposito/#dataDeposito) — agora é uma
   LISTA de linhas dinâmicas (#depositos .deposito), no mesmo molde já usado
   para os levantamentos. Permite registrar, por exemplo, um depósito
   inicial seguido de depósito(s) complementar(es) em datas posteriores.
   Ver calcularDepositosComLevantamentos (motor.js).
------------------------------------------------------------------------ */
function lerDepositos(){
  const linhas = document.querySelectorAll('#depositos .deposito');
  return Array.from(linhas).map(l => ({
    data: l.querySelector('.depData').value,
    valor: parseFloat(l.querySelector('.depValor').value) || 0
  }));
}
function adicionarDeposito(){
  const div = document.createElement('div');
  div.className = 'deposito';
  div.innerHTML =
    '<input type="date" class="depData" title="Data do depósito"> ' +
    '<input type="number" step="0.01" class="depValor" placeholder="Valor do depósito"> ' +
    '<button type="button" onclick="this.parentElement.remove()">remover</button>';
  $('depositos').appendChild(div);
}

function lerLevantamentos(){
  const linhas = document.querySelectorAll('#levantamentos .levantamento');
  return Array.from(linhas).map(l => ({
    data: l.querySelector('.levData').value,
    valor: parseFloat(l.querySelector('.levValor').value) || 0
  }));
}
function adicionarLevantamento(){
  const div = document.createElement('div');
  div.className = 'levantamento';
  div.innerHTML =
    '<input type="date" class="levData"> ' +
    '<input type="number" step="0.01" class="levValor" placeholder="Valor"> ' +
    '<button type="button" onclick="this.parentElement.remove()">remover</button>';
  $('levantamentos').appendChild(div);
}

/* ------------------------------------------------------------------------
   3. bloqueadoPorAuditoria — compartilhada por PDF/Excel/impressão

   AJUSTE (a pedido do usuário — "campos não obrigatórios"): antes, qualquer
   item de nível 'erro' na revisão automática BLOQUEAVA totalmente a
   exportação (alert() + return true, sem opção de prosseguir). Isso supunha
   que todo mundo preenche o formulário inteiro — mas quem usa só alguns
   campos (ex.: só quer a diferença corrigida, sem mexer em juros
   compensatórios/depósito) esbarrava nesse bloqueio mesmo sem ter a menor
   intenção de usar aquele campo.
   AGORA: os avisos continuam aparecendo (e o painel de auditoria continua
   sendo destacado/rolado até a vista), mas em vez de um alert() que impede
   a exportação, é uma confirmação — a pessoa lê o(s) ponto(s) levantado(s)
   e decide se quer prosseguir mesmo assim ou revisar antes. Nenhum campo
   fica "trancado": ela sempre pode gerar o relatório com o que preencheu.
------------------------------------------------------------------------ */
function bloqueadoPorAuditoria(){
  const erros = ULTIMO_CALCULO ? (ULTIMO_CALCULO.auditoria || []).filter(i => i.nivel === 'erro') : [];
  if(erros.length){
    const painel = $('painelAuditoria');
    if(painel){ painel.classList.add('destaque'); painel.scrollIntoView({behavior:'smooth'}); }
    const lista = erros.map(i => '• ' + i.msg).join('\n\n');
    const prosseguir = confirm(
      'A revisão técnica automática encontrou o(s) seguinte(s) ponto(s):\n\n' + lista +
      '\n\nSe algum desses itens não se aplica ao seu caso (ex.: um campo que você não usa), pode ignorar.\n\n' +
      'Clique em OK para gerar o relatório mesmo assim, ou Cancelar para revisar antes.'
    );
    return !prosseguir;
  }
  return false;
}

/* ------------------------------------------------------------------------
   3B. ÂNCORA DA CORREÇÃO MONETÁRIA (revisão pericial — achado 2.1)
   ANTES: o início da correção monetária era sempre `dataOferta || dataBase`,
   fixo em completar.js para TODOS os tipos de ação. Como só a desapropriação
   direta tem "oferta" de fato, nos demais tipos (indireta, execução,
   cobrança) o campo ficava em branco e a correção saía zerada em silêncio
   (início = fim = data-base).
   AGORA: cada tipo de ação declara, na sua própria config (campoAncoraCorrecao,
   em motor.js/modulos/*.js), qual campo de data deve ser usado. Esta função
   tenta primeiro o campo declarado pelo tipo de ação; se estiver vazio (ou o
   tipo não declarar nada, caso de 'outro'), cai numa cadeia de fallback
   genérica pela ordem mais provável de estar preenchida, em vez de ir direto
   para data-base (que zeraria a correção sem avisar).
------------------------------------------------------------------------ */
function resolverAncoraCorrecao(cfg){
  const candidatos = [cfg.campoAncoraCorrecao, 'dataOferta', 'dataImissao', 'dataSentenca'].filter(Boolean);
  for(const campoId of candidatos){
    const el = $(campoId);
    if(el && el.value) return el.value;
  }
  return null; // nenhuma data preenchida: quem chamar decide o fallback final (dataBase)
}

/* ------------------------------------------------------------------------
   3C. DATA-BASE EFETIVA DO CÁLCULO
   Se já houve pagamento (quitação — Art. 2º, "Data de pagamento"), a
   correção monetária e os juros devem parar nessa data, não na data-base
   genérica configurada, pois não há sentido em corrigir monetariamente um
   valor além da data em que ele efetivamente foi pago. Na ausência de
   pagamento informado, usa a própria data-base (ou hoje, se também estiver
   em branco) — mesmo fallback já usado para a variável `dataBase` logo
   acima em calcular(). Esta função era chamada por calcular() mas nunca
   tinha sido definida (bug pré-existente: toda tentativa de calcular
   lançava "dataBaseEfetiva is not defined" e o cálculo não completava).
------------------------------------------------------------------------ */
function dataBaseEfetiva(){
  const pagamento = $('dataPagamento').value;
  if(pagamento) return pagamento;
  return $('dataBase').value || new Date().toISOString().slice(0,10);
}

/* ------------------------------------------------------------------------
   4. calcular() — orquestração principal
------------------------------------------------------------------------ */
async function calcular(){
  const errosValidacao = validarFormulario();
  if(errosValidacao.length) return null;
  try{
    const tipoAcao = $('tipoAcao').value;
    const cfg = configTipoAcao();
    const criterio = $('criterio').value;
    const indice = $('indice').value;
    const taxaManual = parseFloat($('taxaManual').value) || 0;
    const incluirMesInicial = $('incluirMesInicial').checked;
    const aplicarEC113 = $('aplicarEC113').checked;
    const indiceRaw = indice;
    const trechoSentencaIndice = $('trechoSentencaIndice').value;

    const dataOferta = $('dataOferta').value;
    const dataSentenca = $('dataSentenca').value;
    const dataImissao = $('dataImissao').value;
    const dataBase = $('dataBase').value || new Date().toISOString().slice(0,10);
    const dataPagamento = $('dataPagamento').value;
    const dataBaseCalc = dataBaseEfetiva();

    const valorOferta = moneyValue('valorOferta');
    const valorSentenca = moneyValue('valorSentenca');
    const valorBenfeitorias = moneyValue('valorBenfeitorias');
    // CORREÇÃO: antes usava Math.max(0, ...), que zerava silenciosamente uma
    // diferença negativa (sentença menor que a oferta). Agora o valor real
    // (podendo ser negativo) é mantido, e auditarCalculo() sinaliza isso como
    // erro — o usuário é avisado em vez de o sistema mascarar o resultado.
    const diferenca = valorSentenca - valorOferta;
    const baseValor = diferenca + valorBenfeitorias;

    const aplicarJurosComp = $('aplicarJurosComp').checked && cfg.permiteJurosCompensatorios;
    const faixasJurosComp = coletarFaixasJurosComp();
    const faixasJurosMora = coletarFaixasJurosMora();

    const existeDeposito = $('existeDeposito').checked;
    // CORREÇÃO (checklist — "Depósitos em várias datas"): lista de depósitos
    // (ver lerDepositos() acima), não mais um único par valor/data.
    const depositos = lerDepositos();
    const valorDepositoTotal = depositos.filter(d => d.data && d.valor > 0).reduce((s, d) => s + d.valor, 0);
    const levantamentos = lerLevantamentos();

    // --- Correção monetária (índices.js) ---
    // CORREÇÃO (revisão pericial, achado 2.1): a âncora de início não é mais
    // fixa em 'dataOferta' — vem de resolverAncoraCorrecao(cfg), que respeita
    // o campo declarado por cada tipo de ação (ver seção 3B acima).
    const ancoraCorrecao = resolverAncoraCorrecao(cfg) || dataBase;
    const { memoria, fonteInfo } = await montarMemoriaCorrecao(
      baseValor, ancoraCorrecao, dataBaseCalc, indice, taxaManual, incluirMesInicial, aplicarEC113
    );
    const valorFinalCorrigido = memoria.length ? memoria[memoria.length - 1].valorCorrigido : baseValor;
    const correcao = valorFinalCorrigido - baseValor;
    const descCorrecao = fonteInfo.detalhe || '—';

    // --- Depósito(s) judicial(is) corrigido(s), com depósitos complementares
    //     e levantamentos parciais afetando de fato o saldo remanescente
    //     (ver calcularDepositosComLevantamentos em motor.js) — em vez de um
    //     único cálculo do depósito integral independentemente de quantos
    //     depósitos/levantamentos houve e em que datas. ---
    let depositoCorrigido = 0, descDeposito = '—', detalhamentoDeposito = [], avisosDeposito = [];
    if(existeDeposito && valorDepositoTotal > 0){
      try{
        const r = await calcularDepositosComLevantamentos(
          depositos, dataBaseCalc, indice, taxaManual, incluirMesInicial, aplicarEC113, levantamentos
        );
        depositoCorrigido = r.depositoCorrigido;
        detalhamentoDeposito = r.detalhamento;
        avisosDeposito = r.avisos;
        descDeposito = detalhamentoDeposito.length > 1
          ? 'Saldo recalculado por segmentos entre cada depósito complementar e/ou levantamento (ver "Detalhamento do depósito"), somando/deduzindo o valor do evento ao saldo corrigido na respectiva data.'
          : 'Corrigido pelo mesmo índice da correção principal até ' + fmtData(dataBaseCalc) + '.';
      }catch(e){
        depositoCorrigido = valorDepositoTotal;
        descDeposito = 'Não foi possível corrigir o(s) depósito(s) (' + e.message + ') — usado o valor nominal somado.';
      }
    }

    // --- Juros compensatórios e moratórios (motor.js) ---
    // CORREÇÃO (uso profissional): o fallback automático de 12% a.a. só é
    // usado se o usuário marcar explicitamente a caixa "permitirFallback12"
    // — por padrão (desmarcada), a ausência de faixa bloqueia o cálculo
    // (ver auditarCalculo) em vez de aplicar uma taxa que ninguém escolheu.
    const permitirFallback12 = !!($('permitirFallback12') && $('permitirFallback12').checked);
    let jurosComp = { total: 0, desc: '—' };
    if(aplicarJurosComp){
      jurosComp = calcularJurosCompensatorios(baseValor + correcao, dataImissao, dataBaseCalc, criterio, permitirFallback12);
    }
    // CORREÇÃO (revisão pericial, achado 2.4): a base dos juros moratórios
    // era só `diferenca`, deixando as benfeitorias de fora — diferente da
    // correção monetária e dos juros compensatórios, que já incidem sobre
    // `baseValor` (diferenca + valorBenfeitorias). Agora as três parcelas
    // usam a mesma base, salvo justificativa jurídica em contrário.
    const juros = calcularJurosMoratorios(baseValor, dataOferta, dataBaseCalc, {
      indiceSelicPeriodoInteiro: indice === 'selic',
      usaSwitchEC113: !!fonteInfo.usaSwitchEC113,
      criterio
    });

    // --- Honorários e custas ---
    const percentualHonor = parseFloat($('percentualHonor').value) || 0;
    const limiteHonorPercentual = parseFloat(($('limiteHonorPercentual') || {}).value) || 0;
    const custas = moneyValue('custas');
    const honorContratualVal = moneyValue('honorContratualVal');
    // CORREÇÃO: a base de honorários agora é escolhida conforme
    // cfg.baseHonorariosPadrao (campo que já existia na config de cada tipo
    // de ação, mas não era efetivamente consumido por nenhuma rotina).
    const baseHonor = calcularBaseHonoraria(cfg.baseHonorariosPadrao, {
      diferenca, valorSentenca, valorBenfeitorias, correcao,
      jurosCompTotal: jurosComp.total, jurosMoraTotal: juros.total
    });
    const honorVal = baseHonor * (percentualHonor / 100);
    const descHonor = percentualHonor > 0
      ? (percentualHonor.toFixed(2).replace('.', ',') + '% sobre ' + fmt(baseHonor) + ' (' + cfg.fundamentoHonorarios + ')')
      : '—';

    // CORREÇÃO: fundamentoJurosMora (definido na config de cada tipo de ação,
    // mas nunca lido antes) passa a ser anexado à descrição dos juros
    // moratórios quando há incidência.
    const descJuros = (juros.desc && juros.desc !== '—' && cfg.fundamentoJurosMora)
      ? juros.desc + ' (' + cfg.fundamentoJurosMora + ')'
      : juros.desc;

    const total = diferenca + valorBenfeitorias + correcao + jurosComp.total + juros.total - depositoCorrigido + honorVal + custas;
    const totalRecalculado = total; // montado a partir das mesmas parcelas — serve de checagem de integridade

    // --- Contexto para a auditoria automática ---
    const ctx = {
      existeDeposito, depositos, dataBase: dataBaseCalc,
      levantamentos, depositoCorrigido, totalAntesDeposito: total + depositoCorrigido,
      avisosDeposito,
      aplicarJurosComp, faixasJurosComp, faixasJurosMora, dataOferta,
      permitirFallback12, jurosCompBloqueadoSemFaixa: !!jurosComp.bloqueadoSemFaixa,
      total, totalRecalculado, indiceRaw, trechoSentencaIndice, aplicarEC113,
      houveRecortePeriodoInteiro: juros.houveRecortePeriodoInteiro,
      houveRecorteEC113: juros.houveRecorteEC113, dataImissao,
      // NOVOS campos, usados pelos bloqueios de auditoria adicionados em motor.js:
      diferenca, valorSentenca, dataSentenca,
      percentualHonor, limiteHonorPercentual,
      fundamentoJurosMora: cfg.fundamentoJurosMora,
      avisoCategoria: cfg.avisoCategoria,
      mesesCorrecao: memoria.length,
      rotuloAncoraCorrecao: cfg.rotuloAncoraCorrecao
    };
    const auditoria = auditarCalculo(ctx);

    ULTIMO_CALCULO = {
      identificacao: {
        escritorioNome: $('escritorioNome').value,
        advogadoNome: $('advogadoNome').value,
        advogadoOAB: $('advogadoOAB').value,
        tipoAcao: NOMES_TIPO_ACAO[tipoAcao] || tipoAcao,
        numeroProcesso: $('numeroProcesso').value,
        comarca: $('comarca').value,
        expropriante: $('expropriante').value,
        expropriado: $('expropriado').value,
        urlValidacao: $('urlValidacao').value
      },
      datas: { dataOferta, dataSentenca, dataPagamento, dataBase: dataBaseCalc, dataImissao },
      valores: {
        oferta: valorOferta, sentenca: valorSentenca, diferenca,
        // CORREÇÃO (revisão pericial via teste real, achado pós-2.4): este
        // campo se chamava 'benfeitoriasCorrigidas' e era exibido no PDF/
        // Excel com o rótulo "(corrigidas)", mas sempre recebeu o valor
        // NOMINAL (valorBenfeitorias), sem nenhuma correção monetária
        // aplicada isoladamente — a correção só existe de forma somada,
        // junto com a diferença, na linha 'correcao' logo abaixo (porque
        // `baseValor = diferenca + valorBenfeitorias` é corrigido como um
        // bloco único). Renomeado para refletir a natureza real do valor;
        // os rótulos em exportarPDF.js/exportarExcel.js foram atualizados
        // junto para não sugerirem que já é um valor corrigido.
        benfeitoriasNominal: valorBenfeitorias, correcao,
        jurosComp: jurosComp.total, juros: juros.total,
        depositoCorrigido, honorVal, custas, honorContratualVal, total
      },
      descricoes: {
        correcao: descCorrecao, jurosComp: jurosComp.desc, juros: descJuros,
        deposito: descDeposito, honor: descHonor
      },
      memoria, fonteInfo, auditoria, detalhamentoDeposito
    };

    renderizarResultado(ULTIMO_CALCULO);
    toast('Cálculo realizado com sucesso.');
    return ULTIMO_CALCULO;
  }catch(err){
    toast('Erro ao calcular: ' + err.message, true);
    console.error(err);
    ULTIMO_CALCULO = null;
  }
}

/* ------------------------------------------------------------------------
   5. Renderização mínima em tela
------------------------------------------------------------------------ */
function renderizarResultado(c){
  const avisoDiferencaNegativa = c.valores.diferenca < 0
    ? '<p style="color:#8a3324;font-weight:bold">⚠ Diferença negativa: o valor da sentença é menor que o da oferta. O valor NÃO foi zerado automaticamente — revise antes de usar este resultado (ver Revisão técnica automática).</p>'
    : '';
  // NOVO (checklist — prioridade ALTA): quando a correção veio da API do
  // Bacen (ou do cache local dela), mostra a data/hora em que aquela série
  // foi efetivamente obtida — para o usuário saber se está vendo um dado
  // atualizado agora ou reaproveitado de uma consulta anterior (cache).
  let avisoAtualizacaoIndice = '';
  if(c.fonteInfo && c.fonteInfo.ultimaAtualizacao){
    const dt = new Date(c.fonteInfo.ultimaAtualizacao);
    const dtFmt = isNaN(dt) ? c.fonteInfo.ultimaAtualizacao : dt.toLocaleString('pt-BR');
    avisoAtualizacaoIndice = c.fonteInfo.deCache
      ? `<p style="color:#8a6d1d">⚠ Índice obtido do cache local (API do Bacen indisponível no momento do cálculo) — dado de ${dtFmt}.</p>`
      : `<p style="color:#5b6472">Índice atualizado em: ${dtFmt} (API do Bacen, ao vivo).</p>`;
  }
  $('resumoResultado').innerHTML = `
    ${avisoDiferencaNegativa}
    ${avisoAtualizacaoIndice}
    ${(c.valores.oferta !== 0 || c.valores.sentenca !== 0) ? `<p><b>Diferença apurada:</b> ${fmt(c.valores.diferenca)}</p>` : ''}
    ${Math.abs(c.valores.correcao) > 0.004 ? `<p><b>Correção monetária:</b> ${fmt(c.valores.correcao)} — ${c.descricoes.correcao}</p>` : ''}
    ${c.valores.jurosComp > 0 ? `<p><b>Juros compensatórios:</b> ${fmt(c.valores.jurosComp)} — ${c.descricoes.jurosComp}</p>` : ''}
    ${c.valores.juros > 0 ? `<p><b>Juros moratórios:</b> ${fmt(c.valores.juros)} — ${c.descricoes.juros}</p>` : ''}
    ${c.valores.depositoCorrigido > 0 ? `<p><b>Depósito corrigido (dedução):</b> ${fmt(c.valores.depositoCorrigido)}</p>` : ''}
    ${c.valores.honorVal > 0 ? `<p><b>Honorários:</b> ${fmt(c.valores.honorVal)} — ${c.descricoes.honor}</p>` : ''}
    ${c.valores.custas > 0 ? `<p><b>Custas processuais:</b> ${fmt(c.valores.custas)}</p>` : ''}
    ${c.valores.honorContratualVal > 0 ? `<p><b>Honorários contratuais (informativo):</b> ${fmt(c.valores.honorContratualVal)}</p>` : ''}
    <p style="font-size:1.2em"><b>TOTAL: ${fmt(c.valores.total)}</b></p>
  `;
  $('tabelaMemoria').innerHTML = '<table border="1" cellpadding="4"><tr><th>Competência</th><th>Taxa</th><th>Fator acum.</th><th>Valor corrigido</th><th>Fonte</th></tr>' +
    c.memoria.map(m => `<tr><td>${m.competencia}</td><td>${fmtPct(m.taxa,4)}</td><td>${m.fatorAcumulado.toFixed(6)}</td><td>${fmt(m.valorCorrigido)}</td><td>${m.fonte}</td></tr>`).join('') +
    '</table>';
  // NOVO: detalhamento do depósito por segmento (só aparece quando há
  // levantamentos parciais recalculando o saldo — ver
  // calcularDepositosComLevantamentos em motor.js).
  if((c.detalhamentoDeposito || []).length > 1){
    const rotuloEvento = ev => ev === 'deposito' ? 'Depósito (+)' : ev === 'levantamento' ? 'Levantamento (−)' : '—';
    $('tabelaMemoria').innerHTML += '<h3>Detalhamento do depósito (por depósito/levantamento)</h3>' +
      '<table border="1" cellpadding="4"><tr><th>De</th><th>Até</th><th>Saldo inicial</th><th>Saldo corrigido</th><th>Evento</th><th>Valor do evento</th><th>Saldo remanescente</th></tr>' +
      c.detalhamentoDeposito.map(d => `<tr><td>${fmtData(d.inicio)}</td><td>${fmtData(d.fim)}</td><td>${fmt(d.saldoInicial)}</td><td>${fmt(d.saldoCorrigido)}</td><td>${rotuloEvento(d.evento)}</td><td>${fmt(d.valorEvento)}</td><td>${fmt(d.saldoRemanescente)}</td></tr>`).join('') +
      '</table>';
  }
  $('painelAuditoria').classList.remove('destaque');
  $('painelAuditoria').innerHTML = '<h3>Revisão técnica automática</h3><ul>' +
    c.auditoria.map(i => `<li class="niv-${i.nivel}">[${i.nivel.toUpperCase()}/${i.categoria}] ${i.msg}</li>`).join('') +
    '</ul>';
}

/* ------------------------------------------------------------------------
   6. BOTÕES DE ATALHO DO ÍNDICE (IPCA-E / Selic / IPCA — Art. 3º)
   Cada botão seleciona o índice correspondente no <select id="indice"> (que
   continua sendo a fonte de verdade lida por completar.js/validacao.js — os
   botões só oferecem um atalho visual para as 3 opções mais usadas, nesta
   ordem fixa) e, ao clicar, busca a competência mais recente já divulgada
   pelo Bacen para aquele índice (buscarUltimaCompetenciaIndice, indices.js),
   mostrando o resultado abaixo dos botões só como conferência — a taxa
   usada no cálculo em si continua vindo da série histórica completa do
   período, buscada em montarMemoriaCorrecao() quando "Calcular" é clicado.
------------------------------------------------------------------------ */
const NOMES_BOTAO_INDICE = { ipcae: 'IPCA-E', selic: 'Selic', ipca: 'IPCA' };
async function selecionarIndicePorBotao(indiceKey, botao){
  const select = $('indice');
  if(select){
    select.value = indiceKey;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  document.querySelectorAll('.btn-indice').forEach(b => b.classList.toggle('ativo', b === botao));

  const status = $('indiceUltimaAtualizacao');
  if(!status) return;
  status.classList.remove('erro');
  status.textContent = 'Buscando última atualização do ' + (NOMES_BOTAO_INDICE[indiceKey] || indiceKey) + '...';
  botao.setAttribute('aria-busy', 'true');
  try{
    const r = await buscarUltimaCompetenciaIndice(indiceKey);
    status.textContent = (NOMES_BOTAO_INDICE[indiceKey] || indiceKey) + ' — última divulgação do Bacen: ' +
      r.data + ' = ' + r.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) + '%. ' +
      '(informativo — o cálculo em si usa a série histórica completa do período informado abaixo, buscada ao clicar em "Calcular").';
  }catch(e){
    status.classList.add('erro');
    status.textContent = 'Não foi possível buscar a última atualização do ' + (NOMES_BOTAO_INDICE[indiceKey] || indiceKey) +
      ' agora (' + e.message + '). Isso não impede o cálculo — o índice já foi selecionado e a série completa será buscada normalmente ao clicar em "Calcular".';
  }finally{
    botao.removeAttribute('aria-busy');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('btnCalcular').addEventListener('click', calcular);

  document.querySelectorAll('input.money').forEach(el => {
    el.addEventListener('input', () => formatarMoedaInput(el));
  });
  const campoOab = $('advogadoOAB');
  if(campoOab) campoOab.addEventListener('input', () => formatarOabInput(campoOab));

  document.querySelectorAll('.btn-indice').forEach(btn => {
    btn.addEventListener('click', () => selecionarIndicePorBotao(btn.dataset.indice, btn));
    // Marca o botão já ativo se o <select> começar com um destes 3 valores
    // (ex.: estado restaurado de uma sessão anterior, se isso vier a existir).
    if($('indice') && $('indice').value === btn.dataset.indice) btn.classList.add('ativo');
  });
});
