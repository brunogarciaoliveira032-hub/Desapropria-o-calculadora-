/* ============================================================================
   VALIDACAO.JS — Validação completa do formulário antes de calcular.

   Implementa o que motor.js já apontava como pendência ("validarFormulario /
   setFieldError / mostrarErros / indiceEfetivo — ainda no arquivo original").
   Roda ANTES de calcular() (completar.js) e BLOQUEIA o cálculo enquanto
   houver erro: diferente de auditarCalculo() (motor.js), que audita o
   RESULTADO já calculado e é deliberadamente não-bloqueante (permite
   prosseguir mesmo com alertas jurídicos, pois cobre entendimentos
   controversos e campos que a pessoa pode não estar usando), esta validação
   cobre integridade básica dos DADOS de entrada — sem isso o cálculo não
   tem como ser confiável, então aqui sim o envio é bloqueado.

   Cada regra devolve uma mensagem específica (não um "campo inválido"
   genérico), amarrada ao id do campo em que o erro deve aparecer.

   DEPENDE de: js/util.js ($), js/motor.js (configTipoAcao) — carregar depois
   dos dois e antes de js/completar.js.
============================================================================ */

/* ------------------------------------------------------------------------
   1. HELPERS PUROS (sem DOM) — testáveis isoladamente em Node.
------------------------------------------------------------------------ */

// Mesmo formato aceito por moneyValue() (util.js), mas devolve NaN (em vez
// de 0) quando a string não é um número válido, para diferenciar "vazio"
// (0, não é erro) de "preenchido com algo que não é dinheiro" (erro).
// NÃO usar isto sozinho para detectar notação científica: o replace abaixo
// remove letras (inclusive o "e" de "1e20"), então "1e20" viraria "120" em
// vez de ficar inválido — por isso checarCampos() testa notação científica
// ANTES de chamar esta função (ver bloco "Campos monetários").
function parseMoedaValidacao(bruto){
  const s = (bruto || '').toString().trim();
  if(s === '') return 0;
  const limpo = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  if(!/^-?\d+(\.\d+)?$/.test(limpo)) return NaN;
  return parseFloat(limpo);
}

const INDICES_VALIDOS = ['manual', 'selic', 'ipca', 'ipcae', 'inpc', 'sentenca'];

// Teto de sanidade para qualquer valor monetário informado — acima disso é
// quase certamente erro de digitação (ex.: dígito a mais), além de evitar
// perda de precisão em ponto flutuante em somas/correções subsequentes.
const VALOR_MONETARIO_MAXIMO = 999999999999.99; // ~ R$ 1 trilhão

// Datas fora deste intervalo não fazem sentido no domínio do app (processos
// de desapropriação): nunca no futuro, nem antes de um limite histórico
// mínimo razoável.
const DATA_MINIMA_ISO = '1900-01-01';

// Todo campo de data do formulário que participa da validação — usado tanto
// para "existe de fato no calendário" quanto para "não é futura"/"não é
// antiga demais". A lista também documenta os rótulos usados nas mensagens.
const CAMPOS_DATA = [
  ['dataOferta', 'Data da oferta'],
  ['dataSentenca', 'Data da sentença'],
  ['dataImissao', 'Data da imissão na posse'],
  ['dataBase', 'Data-base'],
  ['dataPagamento', 'Data de pagamento'],
  ['faixaCompInicio', 'Início da faixa de juros compensatórios'],
  ['faixaCompFim', 'Fim da faixa de juros compensatórios'],
  ['faixaMoraInicio', 'Início da faixa de juros moratórios'],
  ['faixaMoraFim', 'Fim da faixa de juros moratórios']
];

const CAMPOS_MONETARIOS = [
  ['valorOferta', 'Valor da oferta'],
  ['valorSentenca', 'Valor da sentença'],
  ['valorBenfeitorias', 'Benfeitorias'],
  ['custas', 'Custas processuais'],
  ['honorContratualVal', 'Honorários contratuais']
];

const CAMPOS_PERCENTUAIS = ['percentualHonor', 'limiteHonorPercentual', 'taxaManual', 'faixaCompTaxa', 'faixaMoraTaxa'];

// Todo campo em que checarCampos() pode aplicar alguma regra — usado pela
// validação em tempo real (ver seção 3) para decidir em quais campos vale
// mostrar o ícone de sucesso quando preenchidos sem erro/aviso. Campos fora
// desta lista (ex.: nome do escritório, nº do processo) nunca têm regra
// nenhuma, então não faz sentido "aprová-los" visualmente.
const CAMPOS_VALIDAVEIS = new Set([
  ...CAMPOS_DATA.map(([campo]) => campo),
  ...CAMPOS_MONETARIOS.map(([campo]) => campo),
  ...CAMPOS_PERCENTUAIS,
  'indice'
]);

// Valida que uma string 'yyyy-mm-dd' é uma data que EXISTE de fato no
// calendário (ex.: rejeita 2024-02-31). new Date('2024-02-31') NÃO serve
// para isso sozinho: o motor de datas do JS "rola" o excesso para o mês
// seguinte (vira 2024-03-02) em vez de sinalizar erro — por isso a checagem
// é feita manualmente, reconstruindo o último dia do mês informado.
function dataValida(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [ano, mes, dia] = iso.split('-').map(Number);
  if(mes < 1 || mes > 12) return false;
  const ultimoDiaDoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return dia >= 1 && dia <= ultimoDiaDoMes;
}

// Núcleo da validação: recebe um objeto plano com os valores dos campos
// (ver lerDadosFormulario) e devolve uma lista de { campo, msg }. Não toca
// no DOM — só assim dá para testar as regras sem precisar de um browser.
// `d.hoje` é a data de hoje em ISO (yyyy-mm-dd), injetada por quem chama
// (lerDadosFormulario usa a data real; os testes passam uma data fixa).
function checarCampos(d){
  const erros = [];
  // `nivel`: 'erro' (padrão) BLOQUEIA o cálculo; 'aviso' é exibido junto ao
  // campo e no resumo, mas NÃO bloqueia — reservado para checagens de
  // sanidade/plausibilidade em que um caso real e legítimo, embora raro,
  // ainda pode cair fora do padrão esperado (ex.: data muito antiga, faixa
  // de juros fora do período usual). Falhas de INTEGRIDADE dos dados
  // (obrigatório vazio, NaN, data que não existe, datas invertidas) seguem
  // sempre como 'erro'.
  const add = (campo, msg, nivel) => erros.push({ campo, msg, nivel: nivel || 'erro' });
  const hoje = d.hoje || new Date().toISOString().slice(0, 10);

  /* ---------------- Datas: existem de fato / não são futuras / não são
     antigas demais (checado primeiro, para as demais regras de data já
     partirem de valores em formato garantidamente válido) ---------------- */
  const datasComFormatoValido = {};
  CAMPOS_DATA.forEach(([campo, rotulo]) => {
    const valor = (d[campo] || '').toString().trim();
    if(!valor) return; // vazio: quem exige o campo já avisa em outro bloco
    if(!dataValida(valor)){
      add(campo, rotulo + ': essa data não existe no calendário (confira dia/mês).');
      return;
    }
    datasComFormatoValido[campo] = true;
    if(valor > hoje){
      add(campo, rotulo + ' não pode ser uma data futura.');
    }else if(valor < DATA_MINIMA_ISO){
      // Aviso, não erro: é um limite de plausibilidade, não uma
      // impossibilidade lógica — não bloqueia o cálculo.
      add(campo, rotulo + ': é anterior a ' + DATA_MINIMA_ISO.split('-').reverse().join('/') + ' — confira se a data foi digitada corretamente.', 'aviso');
    }
  });

  /* ---------------- Datas obrigatórias ---------------- */
  if(!d.dataBase){
    add('dataBase', 'Informe a data-base do cálculo — é a referência final da correção monetária e dos juros.');
  }
  if(!d.dataSentenca){
    add('dataSentenca', 'Informe a data da sentença/avaliação — é a referência do valor fixado e das checagens de consistência das demais datas.');
  }
  if(d.exigeOferta && !d.dataOferta){
    add('dataOferta', 'Este tipo de ação exige a data da oferta (rito do Decreto-Lei 3.365/41).');
  }

  /* ---------------- Datas invertidas ----------------
     Só compara pares em que AMBOS os lados têm formato de data válido —
     senão a comparação lexicográfica de uma string malformada pode gerar
     um segundo erro confuso, além do já emitido acima. */
  const parInvalido = (a, b) => !datasComFormatoValido[a] || !datasComFormatoValido[b];
  if(d.dataOferta && d.dataSentenca && !parInvalido('dataOferta', 'dataSentenca') && d.dataOferta > d.dataSentenca){
    add('dataSentenca', 'A data da sentença não pode ser anterior à data da oferta.');
  }
  if(d.dataSentenca && d.dataBase && !parInvalido('dataSentenca', 'dataBase') && d.dataSentenca > d.dataBase){
    add('dataBase', 'A data-base não pode ser anterior à data da sentença.');
  }
  if(d.dataImissao && d.dataBase && !parInvalido('dataImissao', 'dataBase') && d.dataImissao > d.dataBase){
    add('dataImissao', 'A data da imissão na posse não pode ser posterior à data-base.');
  }
  if(d.dataPagamento && d.dataOferta && !parInvalido('dataPagamento', 'dataOferta') && d.dataPagamento < d.dataOferta){
    add('dataPagamento', 'A data de pagamento não pode ser anterior à data da oferta.');
  }
  if(d.faixaCompInicio && d.faixaCompFim && !parInvalido('faixaCompInicio', 'faixaCompFim') && d.faixaCompInicio > d.faixaCompFim){
    add('faixaCompFim', 'O fim da faixa de juros compensatórios não pode ser anterior ao início.');
  }
  if(d.faixaMoraInicio && d.faixaMoraFim && !parInvalido('faixaMoraInicio', 'faixaMoraFim') && d.faixaMoraInicio > d.faixaMoraFim){
    add('faixaMoraFim', 'O fim da faixa de juros moratórios não pode ser anterior ao início.');
  }

  /* ---------------- Campos monetários ---------------- */
  const valoresNum = {};
  CAMPOS_MONETARIOS.forEach(([campo, rotulo]) => {
    const raw = (d[campo] || '').toString().trim();
    if(raw === ''){ valoresNum[campo] = 0; return; }
    // Notação científica (1e20, 2e8...) tem que ser barrada ANTES do parse:
    // parseMoedaValidacao remove letras, então "1e20" viraria silenciosamente
    // "120" em vez de ser rejeitado.
    if(/e/i.test(raw)){
      add(campo, rotulo + ': notação científica não é permitida — digite o valor por extenso (ex.: 1.000.000,00).');
      valoresNum[campo] = NaN;
      return;
    }
    const n = parseMoedaValidacao(raw);
    valoresNum[campo] = n;
    if(Number.isNaN(n)){
      add(campo, rotulo + ': valor monetário inválido.');
    }else if(!Number.isFinite(n)){
      add(campo, rotulo + ': valor monetário excede o limite representável (infinito).');
    }else if(n < 0){
      add(campo, rotulo + ' não pode ser negativo.');
    }else if(n > VALOR_MONETARIO_MAXIMO){
      // Aviso, não erro: teto de sanidade contra dígito a mais, mas um
      // valor real dessa ordem não é impossível — não bloqueia.
      add(campo, rotulo + ': excede o valor máximo esperado (' + VALOR_MONETARIO_MAXIMO.toLocaleString('pt-BR') + ') — confira se não há um dígito a mais.', 'aviso');
    }
  });

  // "Imóvel com valor zero": o valor da sentença é o valor da indenização
  // fixado para o imóvel — sem ele o cálculo inteiro fica sem sentido.
  if(Number.isFinite(valoresNum.valorSentenca) && valoresNum.valorSentenca === 0){
    add('valorSentenca', 'O valor da sentença (indenização do imóvel) não pode ser zero.');
  }

  /* ---------------- Comparação jurídica oferta x sentença ----------------
     Sentença inferior à oferta (diferença negativa) é juridicamente
     atípico — normalmente a sentença fixa indenização maior ou igual à
     oferta inicial (Súmula 141/STJ). O mesmo cenário já é sinalizado
     DEPOIS do cálculo, em motor.js (auditarCalculo -> ctx.diferenca < 0),
     onde bloqueia a geração do relatório até confirmação explícita
     (bloqueadoPorAuditoria). Aqui a mesma checagem é antecipada para a
     validação do FORMULÁRIO — antes de calcular, não só depois — para que
     a pessoa já veja o alerta ao preencher os valores, sem precisar chegar
     ao resultado para descobrir a inconsistência. É aviso, não erro: não
     bloqueia o cálculo aqui (o bloqueio "de fato", com confirmação, segue
     ocorrendo depois, no resultado), pois um caso real e legítimo — embora
     atípico — ainda é possível. */
  if(Number.isFinite(valoresNum.valorOferta) && Number.isFinite(valoresNum.valorSentenca) && valoresNum.valorOferta > valoresNum.valorSentenca){
    add('valorSentenca', 'Valor da sentença: é inferior ao valor da oferta — diferença negativa, juridicamente atípica (a sentença normalmente fixa indenização maior ou igual à oferta, Súmula 141/STJ). Confirme se os valores foram informados corretamente; ao calcular, isso também aparecerá na revisão técnica do resultado.', 'aviso');
  }

  /* ---------------- Percentuais ---------------- */
  const checarPercentual = (campo, rotulo, min, max) => {
    const raw = (d[campo] || '').toString().trim();
    if(raw === '') return; // percentual não obrigatório: só valida quando preenchido
    if(/e/i.test(raw)){
      add(campo, rotulo + ': notação científica não é permitida.');
      return;
    }
    const normalizado = raw.replace(',', '.');
    if(!/^-?\d+(\.\d+)?$/.test(normalizado)){
      add(campo, rotulo + ': percentual inválido.');
      return;
    }
    const n = parseFloat(normalizado);
    if(!Number.isFinite(n)){
      add(campo, rotulo + ': percentual inválido.');
      return;
    }
    if(n < min) add(campo, rotulo + ' não pode ser negativo.');
    if(max !== null && n > max) add(campo, rotulo + ' não pode ser maior que ' + max + '%.');
    const casasDecimais = (normalizado.split('.')[1] || '').length;
    if(casasDecimais > 2){
      add(campo, rotulo + ': mais de 2 casas decimais — o valor será considerado, mas confira o arredondamento.', 'aviso');
    }
  };
  // Honorários são proporções (parte de um total) — intervalo 0–100% cabe
  // aqui. Taxas de juros (% a.a./a.m.) NÃO são limitadas a 100: o histórico
  // de correção monetária no Brasil já teve taxas mensais/anuais superiores
  // a isso (hiperinflação) — por isso só ficam com piso em 0.
  checarPercentual('percentualHonor', '% Honorários sucumbenciais', 0, 100);
  checarPercentual('limiteHonorPercentual', 'Limite % honorários', 0, 100);
  checarPercentual('taxaManual', 'Taxa manual', 0, null);
  checarPercentual('faixaCompTaxa', 'Taxa de juros compensatórios', 0, null);
  checarPercentual('faixaMoraTaxa', 'Taxa de juros moratórios', 0, null);

  /* ---------------- Datas de incidência dos juros fazem sentido ----------------
     As faixas de juros compensatórios/moratórios já são checadas (acima)
     quanto a início<=fim; aqui se checa se elas fazem sentido em relação ao
     RESTO do caso: não podem começar antes do marco que as origina, nem
     terminar depois da data até a qual o cálculo é feito. Isso é aviso (não
     bloqueia), pois pode refletir uma opção deliberada e defensável (ex.:
     recorte proposital de período) que a pessoa decide manter mesmo assim. */
  const dataBaseCalc = d.dataPagamento || d.dataBase;
  if(d.faixaCompInicio && d.dataImissao && !parInvalido('faixaCompInicio', 'dataImissao') && d.faixaCompInicio < d.dataImissao){
    add('faixaCompInicio', 'Início da faixa de juros compensatórios: é anterior à data da imissão na posse — confira se faz sentido incidir juros compensatórios antes desse marco.', 'aviso');
  }
  if(d.faixaCompFim && dataBaseCalc && !parInvalido('faixaCompFim', dataBaseCalc === d.dataPagamento ? 'dataPagamento' : 'dataBase') && d.faixaCompFim > dataBaseCalc){
    add('faixaCompFim', 'Fim da faixa de juros compensatórios: é posterior à data-base/pagamento do cálculo — o trecho além dessa data não terá efeito.', 'aviso');
  }
  if(d.faixaMoraInicio && d.dataOferta && !parInvalido('faixaMoraInicio', 'dataOferta') && d.faixaMoraInicio < d.dataOferta){
    add('faixaMoraInicio', 'Início da faixa de juros moratórios: é anterior à data da oferta — confira se faz sentido incidir juros moratórios antes desse marco.', 'aviso');
  }
  if(d.faixaMoraFim && dataBaseCalc && !parInvalido('faixaMoraFim', dataBaseCalc === d.dataPagamento ? 'dataPagamento' : 'dataBase') && d.faixaMoraFim > dataBaseCalc){
    add('faixaMoraFim', 'Fim da faixa de juros moratórios: é posterior à data-base/pagamento do cálculo — o trecho além dessa data não terá efeito.', 'aviso');
  }

  /* ---------------- Competência inicial e final da correção monetária ----------------
     A correção monetária corre de uma data-âncora ("competência inicial" —
     varia por tipo de ação: oferta, imissão ou sentença, ver
     configTipoAcao().campoAncoraCorrecao) até a data-base efetiva
     ("competência final" — data de pagamento, se houver, senão a data-base).
     Isso é um ERRO bloqueante (não aviso): correção monetária não pode
     "andar para trás" — se a competência inicial vier depois da final, o
     período de cálculo é logicamente inválido, não apenas incomum. */
  const camposAncora = ['dataOferta', 'dataImissao', 'dataSentenca'];
  const campoAncora = (d.campoAncoraCorrecao && camposAncora.includes(d.campoAncoraCorrecao) && d[d.campoAncoraCorrecao])
    ? d.campoAncoraCorrecao
    : camposAncora.find(c => d[c]);
  const competenciaInicial = campoAncora ? d[campoAncora] : null;
  if(competenciaInicial && dataBaseCalc){
    const campoFinal = d.dataPagamento ? 'dataPagamento' : 'dataBase';
    if(!parInvalido(campoAncora, campoFinal) && competenciaInicial > dataBaseCalc){
      add(campoFinal, 'A competência final da correção monetária (' + (d.dataPagamento ? 'data de pagamento' : 'data-base') + ') não pode ser anterior à competência inicial (' + (d.rotuloAncoraCorrecao || 'data-âncora da correção, ' + campoAncora) + ').');
    }
  }

  /* ---------------- Índice ----------------
     "Possui série histórica para a competência informada" é checado à
     parte, em tempo de cálculo (js/indices.js -> montarMemoriaCorrecao),
     pois depende de uma consulta à API do Bacen — não dá para validar isso
     só olhando o formulário, sem rede. Aqui só se garante que o valor do
     <select> é uma das opções que o app realmente sabe tratar. */
  if(!INDICES_VALIDOS.includes(d.indice)){
    add('indice', 'Índice de correção inexistente/inválido — selecione uma das opções da lista.');
  }

  return erros;
}

/* ------------------------------------------------------------------------
   2. INTEGRAÇÃO COM O DOM
------------------------------------------------------------------------ */

function lerDadosFormulario(){
  const cfg = (typeof configTipoAcao === 'function') ? configTipoAcao() : {};
  const val = id => ($(id) ? $(id).value : '');
  return {
    exigeOferta: !!cfg.exigeOferta,
    campoAncoraCorrecao: cfg.campoAncoraCorrecao || null,
    rotuloAncoraCorrecao: cfg.rotuloAncoraCorrecao || null,
    hoje: new Date().toISOString().slice(0, 10),
    dataBase: val('dataBase'),
    dataSentenca: val('dataSentenca'),
    dataOferta: val('dataOferta'),
    dataImissao: val('dataImissao'),
    dataPagamento: val('dataPagamento'),
    valorOferta: val('valorOferta'),
    valorSentenca: val('valorSentenca'),
    valorBenfeitorias: val('valorBenfeitorias'),
    custas: val('custas'),
    honorContratualVal: val('honorContratualVal'),
    percentualHonor: val('percentualHonor'),
    limiteHonorPercentual: val('limiteHonorPercentual'),
    indice: val('indice'),
    taxaManual: val('taxaManual'),
    faixaCompInicio: val('faixaCompInicio'),
    faixaCompFim: val('faixaCompFim'),
    faixaCompTaxa: val('faixaCompTaxa'),
    faixaMoraInicio: val('faixaMoraInicio'),
    faixaMoraFim: val('faixaMoraFim'),
    faixaMoraTaxa: val('faixaMoraTaxa')
  };
}

// Devolve, de uma lista de { campo, msg, nivel }, no máximo UM item por
// campo — preferindo 'erro' sobre 'aviso' quando o mesmo campo acumula os
// dois. Evita tanto mensagens duplicadas quanto mais de um erro visível no
// mesmo campo (a pessoa corrige um problema por vez, não uma lista inteira
// empilhada sob o mesmo input).
function umPorCampo(itens){
  const porCampo = {};
  itens.forEach(item => {
    const atual = porCampo[item.campo];
    if(!atual || (atual.nivel === 'aviso' && item.nivel === 'erro')){
      porCampo[item.campo] = item;
    }
  });
  // Preserva a ordem original de primeira aparição de cada campo.
  const vistos = new Set();
  const ordenado = [];
  itens.forEach(item => {
    if(!vistos.has(item.campo)){
      vistos.add(item.campo);
      ordenado.push(porCampo[item.campo]);
    }
  });
  return ordenado;
}

function limparErrosFormulario(){
  document.querySelectorAll('.campo-erro').forEach(el => el.classList.remove('campo-erro'));
  document.querySelectorAll('.campo-aviso').forEach(el => el.classList.remove('campo-aviso'));
  document.querySelectorAll('.campo-valido').forEach(el => el.classList.remove('campo-valido'));
  document.querySelectorAll('.msg-erro-campo').forEach(el => el.remove());
  document.querySelectorAll('.msg-aviso-campo').forEach(el => el.remove());
  document.querySelectorAll('.msg-sucesso-campo').forEach(el => el.remove());
  const resumoErros = $('erros-formulario');
  if(resumoErros){ resumoErros.innerHTML = ''; resumoErros.style.display = 'none'; }
  const resumoAvisos = $('avisos-formulario');
  if(resumoAvisos){ resumoAvisos.innerHTML = ''; resumoAvisos.style.display = 'none'; }
}

// Remove qualquer estado visual (erro, aviso OU sucesso) de UM campo, sem
// tocar nos demais — usado antes de aplicar um novo estado no mesmo campo,
// tanto pela limpeza ingênua ao digitar quanto pela revalidação em tempo
// real (ver revalidarCampo, seção 3).
function limparEstadoCampo(el){
  el.classList.remove('campo-erro', 'campo-aviso', 'campo-valido');
  const prox = el.nextElementSibling;
  if(prox && (prox.classList.contains('msg-erro-campo') || prox.classList.contains('msg-aviso-campo') || prox.classList.contains('msg-sucesso-campo'))){
    prox.remove();
  }
}
// Nome antigo mantido como alias (compatibilidade com o listener original).
function limparErroDoCampo(el){ limparEstadoCampo(el); }

// `nivel` decide a classe do campo/mensagem ('erro' ou 'aviso') — mesma
// função para os dois, para garantir que o estilo visual das duas
// categorias fique consistente em todo o app (ver auditarCalculo, que usa
// o mesmo par erro/alerta em outro contexto).
function setFieldError(campoId, msg, nivel){
  const el = $(campoId);
  if(!el) return;
  const classeCampo = nivel === 'aviso' ? 'campo-aviso' : 'campo-erro';
  const classeMsg = nivel === 'aviso' ? 'msg-aviso-campo' : 'msg-erro-campo';
  el.classList.add(classeCampo);
  const small = document.createElement('small');
  small.className = classeMsg;
  small.textContent = msg;
  el.insertAdjacentElement('afterend', small);
}

// Feedback positivo: campo com regra de validação (ver CAMPOS_VALIDAVEIS),
// preenchido e sem erro/aviso pendente. Só chamado pela validação em tempo
// real (revalidarCampo) — validarFormulario()/mostrarErros() (o fluxo do
// botão "Calcular") não precisam disso, pois nesse ponto só sobra o que
// ainda está errado.
function setFieldSucesso(campoId){
  const el = $(campoId);
  if(!el) return;
  el.classList.add('campo-valido');
  const small = document.createElement('small');
  small.className = 'msg-sucesso-campo';
  small.textContent = '✓ Válido';
  el.insertAdjacentElement('afterend', small);
}

function montarResumo(id, titulo, itens, nivel){
  let resumo = $(id);
  if(!resumo){
    resumo = document.createElement('div');
    resumo.id = id;
    const acoes = document.querySelector('.actions');
    if(acoes && acoes.parentElement){
      acoes.parentElement.insertBefore(resumo, acoes);
    }else{
      document.body.appendChild(resumo);
    }
  }
  if(!itens.length){ resumo.style.display = 'none'; resumo.innerHTML = ''; return resumo; }
  resumo.style.display = 'block';
  resumo.innerHTML = '<h3>' + titulo + '</h3><ul>' +
    itens.map(e => '<li>' + e.msg + '</li>').join('') + '</ul>';
  return resumo;
}

function mostrarErros(itens){
  itens.forEach(e => setFieldError(e.campo, e.msg, e.nivel));

  const erros = itens.filter(e => e.nivel === 'erro');
  const avisos = itens.filter(e => e.nivel === 'aviso');

  const resumoAvisos = montarResumo('avisos-formulario', '⚠ Pontos de atenção (não impedem o cálculo)', avisos, 'aviso');
  const resumoErros = montarResumo('erros-formulario', '✕ Corrija os campos abaixo antes de calcular', erros, 'erro');

  // Erros bloqueantes têm prioridade de foco/rolagem sobre avisos: é o que
  // impede a pessoa de prosseguir, então é o primeiro problema a resolver.
  // Rola até o painel que de fato está visível (erros, ou avisos se não
  // houver nenhum erro) — nunca até um painel oculto.
  const destaque = erros.length ? erros[0] : avisos[0];
  const resumoVisivel = erros.length ? resumoErros : resumoAvisos;
  if(destaque){
    resumoVisivel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const campo = $(destaque.campo);
    if(campo){
      campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
      campo.focus();
    }
  }

  if(erros.length){
    toast('Há ' + erros.length + ' campo(s) com erro no formulário.', true);
  }else if(avisos.length){
    toast('Há ' + avisos.length + ' ponto(s) de atenção — confira antes de prosseguir.', false);
  }
}

// Mostra/oculta o marcador "*" de "Data da oferta" conforme o tipo de ação
// selecionado exige ou não esse campo (configTipoAcao().exigeOferta) — os
// demais campos obrigatórios (data-base, data da sentença, valor da
// sentença) são sempre exigidos, então seu marcador já fica fixo no HTML.
function atualizarMarcadoresObrigatorios(){
  const reqOferta = $('reqOferta');
  if(!reqOferta) return;
  const cfg = (typeof configTipoAcao === 'function') ? configTipoAcao() : {};
  reqOferta.style.display = cfg.exigeOferta ? 'inline' : 'none';
}

/* ------------------------------------------------------------------------
   3. VALIDAÇÃO EM TEMPO REAL (enquanto a pessoa digita, sem esperar o
   clique em "Calcular") — prioridade baixa da checklist de UX:
     - valida a cada alteração, não só no envio;
     - remove o erro/aviso sozinho quando o valor é corrigido (e só então
       — releitura real, não apenas "some porque a pessoa tocou o campo",
       como o comportamento ingênuo anterior fazia);
     - mantém o destaque de borda vermelha/pontilhada já existente;
     - acrescenta um ícone de sucesso (✓, borda verde) quando o campo tem
       regra de validação e está preenchido sem erro nem aviso.
------------------------------------------------------------------------ */

// Revalida UM campo isoladamente (a partir do estado atual do formulário
// inteiro, pois algumas regras são relacionais — ex.: data da sentença
// depende da data da oferta) e atualiza sua UI: erro, aviso, sucesso, ou
// neutro (campo fora de CAMPOS_VALIDAVEIS, ou dentro dela mas ainda vazio
// e não obrigatório — não faz sentido "aprovar" um campo em branco).
function revalidarCampo(el){
  if(!el || !el.id) return;
  limparEstadoCampo(el);
  const dados = lerDadosFormulario();
  const item = umPorCampo(checarCampos(dados)).find(i => i.campo === el.id);
  if(item){
    setFieldError(item.campo, item.msg, item.nivel);
  }else if(CAMPOS_VALIDAVEIS.has(el.id) && (el.value || '').toString().trim() !== ''){
    setFieldSucesso(el.id);
  }
}

// Depois de revalidar um campo, também atualiza os PAINÉIS-RESUMO (se já
// existirem na tela, de uma tentativa anterior de calcular) para não
// deixar uma mensagem antiga lá depois que o campo já foi corrigido — sem
// isso, a lista de erros no topo ficaria desatualizada em relação aos
// campos, que já mostram o estado correto individualmente.
function atualizarResumosEmTempoReal(){
  const dados = lerDadosFormulario();
  const todos = umPorCampo(checarCampos(dados));
  const erros = todos.filter(e => e.nivel === 'erro');
  const avisos = todos.filter(e => e.nivel === 'aviso');
  if($('erros-formulario')) montarResumo('erros-formulario', '✕ Corrija os campos abaixo antes de calcular', erros, 'erro');
  if($('avisos-formulario')) montarResumo('avisos-formulario', '⚠ Pontos de atenção (não impedem o cálculo)', avisos, 'aviso');
}

// Debounce por campo: valida ~350ms depois da última tecla digitada, não a
// cada tecla — evita marcar erro num valor monetário/data que a pessoa
// ainda está no meio de digitar, e evita trabalho desnecessário a cada
// pressionar de tecla.
const TIMERS_REVALIDACAO = {};
function agendarRevalidacao(el){
  if(!el || !el.id) return;
  clearTimeout(TIMERS_REVALIDACAO[el.id]);
  TIMERS_REVALIDACAO[el.id] = setTimeout(() => {
    revalidarCampo(el);
    atualizarResumosEmTempoReal();
  }, 350);
}

// Ponto de entrada chamado por calcular() (completar.js) antes de qualquer
// leitura/cálculo. Devolve a lista de ERROS bloqueantes (vazia = nenhum
// erro — mas ainda pode haver avisos exibidos, que não impedem o cálculo).
function validarFormulario(){
  limparErrosFormulario();
  const dados = lerDadosFormulario();
  const todos = umPorCampo(checarCampos(dados));
  if(todos.length) mostrarErros(todos);
  return todos.filter(e => e.nivel === 'erro');
}

// `typeof document` protege o require() deste arquivo em Node (suíte de
// testes, sem DOM disponível) — nada abaixo roda fora do navegador.
if(typeof document !== 'undefined'){
  // 'input' dispara a cada tecla (texto/número) — usa debounce.
  document.addEventListener('input', (e) => {
    if(e.target && e.target.id) agendarRevalidacao(e.target);
  });
  // 'change' dispara ao confirmar o valor (date picker, select, ou perder
  // o foco de um texto/número) — valida imediatamente, sem debounce.
  document.addEventListener('change', (e) => {
    if(!e.target) return;
    if(e.target.id === 'tipoAcao') atualizarMarcadoresObrigatorios();
    if(e.target.id){
      clearTimeout(TIMERS_REVALIDACAO[e.target.id]);
      revalidarCampo(e.target);
      atualizarResumosEmTempoReal();
    }
  });
  document.addEventListener('DOMContentLoaded', atualizarMarcadoresObrigatorios);
  // Se o DOM já estiver pronto quando este script carregar (ex.: script no
  // fim do <body>), DOMContentLoaded já disparou e não vai disparar de
  // novo — chama direto para não deixar o marcador com o estado inicial
  // errado até a primeira troca manual do tipo de ação.
  if(document.readyState !== 'loading') atualizarMarcadoresObrigatorios();
}

// Exporta as funções puras para Node (suíte de testes), sem afetar o uso
// no browser (onde `module` não existe).
if(typeof module !== 'undefined' && module.exports){
  module.exports = { checarCampos, umPorCampo, parseMoedaValidacao, dataValida, INDICES_VALIDOS, VALOR_MONETARIO_MAXIMO, DATA_MINIMA_ISO };
}
