/* ============================================================================
   MOTOR.JS — Cálculos comuns e regras de negócio por tipo de ação

   Extraído do arquivo original "calculadora_desapropriacao-parte1-motor-por
   -tipo-1.html". Nenhuma alteração de lógica de cálculo — apenas realocação
   de código.

   ATUALIZAÇÃO (arquitetura de módulos por tipo de ação): MOTORES_TIPO_ACAO
   e NOMES_TIPO_ACAO deixaram de ser objetos totalmente hardcoded aqui para
   virarem um REGISTRO que cada módulo de /modulos/ preenche via
   registrarTipoAcao() ao ser carregado (ver carregador.js). Por ora
   'desapropriacao' e 'indenizacao' foram migradas para modulos/direta.js e
   modulos/indireta.js — as demais entradas (execucao, cobranca, outro)
   continuam hardcoded abaixo até que os módulos correspondentes sejam
   criados. Isso significa que motor.js sozinho NÃO tem mais a config
   completa desses dois tipos: os respectivos módulos precisam ser
   carregados (pelo carregador ou por um <script> fixo) antes de
   configTipoAcao() ser chamada para eles, senão cai no fallback 'outro'.

   DEPENDE de js/util.js (usa $, fmtData, contarPeriodo) já carregado antes
   deste arquivo.

   ESCOPO DESTE ARQUIVO (o que entrou):
     - Registro de negócio por tipo de ação (MOTORES_TIPO_ACAO/NOMES_TIPO_ACAO
       + registrarTipoAcao) e os getters que o consultam (configTipoAcao,
       ehTipoAcaoIndireta, ehTipoAcaoDesapropriacao).
     - Estado do último cálculo (ULTIMO_CALCULO), consumido depois por
       exportarPDF.js e exportarExcel.js.
     - Fórmulas de juros compensatórios e moratórios.
     - Revisão técnica automática (auditarCalculo) — a checagem de
       consistência matemática/jurídica que roda antes de liberar PDF/Excel.

   O QUE FICOU DE FORA DE PROPÓSITO (ainda no arquivo original, pendente de
   decidirmos juntos onde migrar):
     - validarFormulario / setFieldError / mostrarErros — agora IMPLEMENTADOS
       em js/validacao.js (validação bloqueante de dados de entrada, rodando
       antes de calcular() em completar.js). Continuam fora deste arquivo de
       propósito: motor.js é sobre regras de cálculo, não sobre o formulário.
     - coletarFaixasJurosComp() / coletarFaixasJurosMora() (e os respectivos
       criar/limpar/preencher) — são gerenciadores de linhas dinâmicas do
       formulário (DOM puro). calcularJurosCompensatorios/Moratorios abaixo
       CONTINUAM chamando essas duas funções por nome; elas precisam existir
       em algum script carregado junto (por ora, no arquivo original/
       index.html) até decidirmos o destino final delas.
     - A função calcular() (orquestração principal: lê ~30 campos do
       formulário, monta o ledger, chama renderizações) e as próprias
       renderizações (renderizarTabelaMemoria/Historico/Auditoria) — são o
       "cola" entre motor, índices e tela; ainda misturam bastante DOM com
       lógica no arquivo original, então preferi não mover sem conversar
       sobre como (ou se) separar a parte de tela da parte de cálculo.
============================================================================ */

/* ------------------------------------------------------------------------
   1. CONFIG DE NEGÓCIO POR TIPO DE AÇÃO
   Cada tipo de ação tem fundamentos jurídicos distintos para: juros
   compensatórios (só cabem em desapropriação), termo inicial dos juros
   moratórios, existência de "oferta"/depósito prévio (exclusivo do rito do
   DL 3.365/41) e a base de cálculo dos honorários sucumbenciais. Este objeto
   concentra essas diferenças num único lugar, em vez de espalhar
   `if(tipoAcao === ...)` pelo código — o motor de cálculo e o PDF/Excel
   consomem esta mesma config.

   IMPORTANTE (ver conversa/teste anterior): "execução de título judicial"
   não é uma categoria substantiva própria — é uma FASE processual de um
   título que pode ser, por exemplo, uma desapropriação indireta já
   transitada em julgado. A configuração abaixo trata os 4 valores do
   <select> como estão hoje (compatibilidade com registros já salvos), mas
   sinaliza esse ponto via `avisoCategoria` para o usuário conferir o
   fundamento antes de usar o resultado.

   ATENÇÃO — pendência já reportada anteriormente e ainda não corrigida
   aqui (só realoquei o código): `baseHonorariosPadrao`, `fundamentoHonorarios`
   e `fundamentoJurosMora` são definidos para cada tipo de ação mas, no
   restante do código-fonte original, nunca são efetivamente lidos por
   nenhuma função de cálculo, renderização, PDF ou Excel — ficam "mortos".
   Além disso, `calcularJurosCompensatorios` (seção 3 abaixo) decide o
   fundamento a citar via `ehTipoAcaoIndireta()`, duplicando de forma solta
   a informação que já está em `fundamentoJurosComp` desta config, em vez de
   ler o valor daqui.
------------------------------------------------------------------------ */
// 'desapropriacao' e 'indenizacao' NÃO estão mais aqui — passaram a ser
// registradas por modulos/direta.js e modulos/indireta.js, via
// registrarTipoAcao() (ver função abaixo). As demais entradas continuam
// hardcoded até seus módulos serem criados.
const NOMES_TIPO_ACAO = {
  execucao: 'Execução de título judicial',
  cobranca: 'Ação de cobrança',
  outro: 'Outro'
};

const MOTORES_TIPO_ACAO = {
  execucao: {
    label: 'Execução de título judicial',
    exigeOferta: false,
    exigeDepositoPossivel: false,
    permiteJurosCompensatorios: false,
    fundamentoJurosComp: null,
    // CORREÇÃO (revisão pericial): este tipo não tem "oferta" — usar dataOferta
    // como âncora da correção monetária (como o código fazia antes, fixo para
    // todos os tipos) zerava silenciosamente a correção sempre que o campo
    // ficasse em branco. A âncora correta aqui é a data do próprio título
    // exequendo (sentença/acórdão transitado em julgado).
    campoAncoraCorrecao: 'dataSentenca',
    rotuloAncoraCorrecao: 'Data do título executivo (sentença/acórdão)',
    rotuloTermoInicialJurosComp: 'Data de constituição em mora (trânsito em julgado ou termo fixado no título)',
    notaTermoInicialJurosComp: 'Execução de título judicial não admite juros compensatórios (instituto próprio da desapropriação) — apenas juros de mora, cujo termo inicial depende do que já foi decidido no título executivo.',
    baseHonorariosPadrao: 'valor_titulo',
    fundamentoHonorarios: 'CPC, art. 85, §§1º e 7º — inclui a multa de 10% do art. 523, §1º, CPC se não houver pagamento voluntário em 15 dias (não calculada automaticamente aqui)',
    fundamentoJurosMora: 'conforme fixado no título executivo (sentença/acórdão) — confira o dispositivo transitado em julgado',
    avisoCategoria: 'Confira se o título exequendo é, na origem, uma desapropriação direta ou indireta: se for, os fundamentos de juros compensatórios e correção monetária dessa origem continuam se aplicando na fase de execução — este motor cobre apenas os encargos próprios da fase executiva (juros de mora e honorários de cumprimento de sentença).'
  },
  cobranca: {
    label: 'Ação de cobrança',
    exigeOferta: false,
    exigeDepositoPossivel: false,
    permiteJurosCompensatorios: false,
    fundamentoJurosComp: null,
    // CORREÇÃO (revisão pericial): idem ao caso de 'execucao' — sem "oferta",
    // a âncora da correção precisa vir de outro campo, senão zera em silêncio.
    // Usa a data da sentença/título como proxy até existir um campo próprio
    // de "vencimento"/"citação" na tela.
    campoAncoraCorrecao: 'dataSentenca',
    rotuloAncoraCorrecao: 'Data da sentença/título (ou vencimento/citação, se anterior)',
    rotuloTermoInicialJurosComp: 'Data da citação ou do vencimento (se mora ex re)',
    notaTermoInicialJurosComp: 'Ação de cobrança comum não admite juros compensatórios. Os juros de mora contam-se, em regra, da citação (art. 405, CC) ou do vencimento, se a mora decorrer automaticamente do inadimplemento (art. 397, CC).',
    baseHonorariosPadrao: 'valor_principal',
    fundamentoHonorarios: 'CPC, art. 85 — percentual sobre o valor da condenação/proveito econômico',
    fundamentoJurosMora: 'art. 405 (citação) ou art. 397 (vencimento), ambos do Código Civil',
    avisoCategoria: 'Esta é uma dívida civil comum, sem relação com o regime da desapropriação (DL 3.365/41). Não use fundamentos de juros compensatórios, Súmula 69/408 ou depósito prévio para este tipo de ação.'
  },
  outro: {
    label: 'Outro',
    exigeOferta: false,
    exigeDepositoPossivel: false,
    permiteJurosCompensatorios: false,
    fundamentoJurosComp: null,
    rotuloTermoInicialJurosComp: 'Data de referência para os encargos (defina conforme o caso)',
    notaTermoInicialJurosComp: 'Tipo de ação não mapeado por um motor específico. Confirme manualmente todos os fundamentos jurídicos antes de usar o resultado.',
    baseHonorariosPadrao: 'valor_principal',
    fundamentoHonorarios: 'Defina manualmente o fundamento aplicável.',
    fundamentoJurosMora: 'Defina manualmente o termo inicial aplicável.',
    avisoCategoria: 'Tipo de ação genérico — nenhum motor jurídico específico foi configurado. Revise manualmente todos os fundamentos antes de usar o cálculo.'
  }
};

// Ponto de extensão usado pelos módulos de /modulos/ (ex.: direta.js) para
// registrar a config de um tipo de ação sem precisar editar este arquivo.
// chave: valor de <option> em #tipoAcao (ex.: 'desapropriacao').
// nome: rótulo amigável (vai para NOMES_TIPO_ACAO).
// config: mesmo formato dos objetos já existentes em MOTORES_TIPO_ACAO
// acima (exigeOferta, exigeDepositoPossivel, permiteJurosCompensatorios,
// fundamentoJurosComp, rotuloTermoInicialJurosComp, notaTermoInicialJurosComp,
// baseHonorariosPadrao, fundamentoHonorarios, fundamentoJurosMora,
// avisoCategoria).
function registrarTipoAcao(chave, nome, config){
  NOMES_TIPO_ACAO[chave] = nome;
  MOTORES_TIPO_ACAO[chave] = config;
}

// Config do tipo de ação atualmente selecionado (com fallback seguro para "outro").
function configTipoAcao(){
  const tipo = $('tipoAcao').value;
  return MOTORES_TIPO_ACAO[tipo] || MOTORES_TIPO_ACAO.outro;
}

function ehTipoAcaoIndireta(){
  return $('tipoAcao').value === 'indenizacao';
}

// Mantida por compatibilidade com trechos que ainda testam explicitamente
// "é desapropriação (direta ou indireta)?" — usada para decidir se o campo
// "data da imissão/ocupação" e o bloco de juros compensatórios fazem sentido.
function ehTipoAcaoDesapropriacao(){
  const cfg = configTipoAcao();
  return cfg.permiteJurosCompensatorios === true;
}

// Guarda em memória o resultado do último cálculo, para reaproveitar
// nas exportações (PDF/Excel) sem precisar recalcular tudo de novo.
let ULTIMO_CALCULO = null;

/* ------------------------------------------------------------------------
   2. REVISÃO TÉCNICA AUTOMÁTICA (AUDITORIA)
   Verificações de dois tipos:
     - 'matematica': integridade numérica/estrutural (datas, somas, faixas,
        sobreposições) — problemas que impedem o cálculo de ser confiável
        independentemente do entendimento jurídico adotado.
     - 'juridica': a composição dos encargos (juros compensatórios,
        moratórios, índice de correção) pode ser incompatível com o marco
        legal aplicável ao período do cálculo, mesmo quando as contas em si
        "fecham" matematicamente — por isso essa categoria existe à parte.
------------------------------------------------------------------------ */
function auditarCalculo(ctx){
  const itens = []; // { nivel: 'erro' | 'alerta' | 'info' | 'ok', categoria: 'matematica' | 'juridica', msg }
  const add = (nivel, categoria, msg) => itens.push({ nivel, categoria, msg });
  const antes = (a, b) => a && b && new Date(a) < new Date(b);
  const depois = (a, b) => a && b && new Date(a) > new Date(b);

  /* ======================= 0. AVISO DE CATEGORIA DO TIPO DE AÇÃO ======================= */
  // CORREÇÃO (revisão pericial, achado 2.7): cada tipo de ação já definia,
  // em configTipoAcao()/módulos, um `avisoCategoria` orientando sobre os
  // limites e riscos de confusão daquele tipo (ex.: não confundir com
  // dívida civil comum) — mas esse campo nunca era lido em lugar nenhum.
  // Passa a ser exibido como o primeiro item da revisão técnica.
  if(ctx.avisoCategoria){
    add('info', 'juridica', ctx.avisoCategoria);
  }

  /* ======================= 1. ERRO MATEMÁTICO ======================= */
  // Integridade numérica/estrutural: datas, somas, faixas, sobreposições.

  // --- Depósito(s) judicial(is) e levantamentos ---
  // CORREÇÃO (checklist — "Depósitos em várias datas"): o depósito deixou de
  // ser um único par valor/data — ctx.depositos agora é uma LISTA (ex.:
  // depósito inicial + depósito(s) complementar(es) posteriores), no mesmo
  // molde já usado para levantamentos. Todas as checagens abaixo passam a
  // considerar a lista inteira em vez de um único valor/data.
  const depositosValidos = (ctx.depositos || []).filter(d => d.data && d.valor > 0);
  const primeiraDataDeposito = depositosValidos.length
    ? depositosValidos.map(d => d.data).sort()[0]
    : null;
  const totalDepositado = depositosValidos.reduce((s, d) => s + d.valor, 0);

  if(ctx.existeDeposito){
    if(depositosValidos.length === 0){
      add('alerta', 'matematica', 'Depósito judicial marcado como existente, mas nenhum depósito com valor e data foi informado (Art. 2º) — nada será deduzido do total.');
    }
    if((ctx.depositos || []).some(d => (d.data && !d.valor) || (!d.data && d.valor))){
      add('alerta', 'matematica', 'Há uma linha de depósito judicial incompleta (falta valor ou data).');
    }
    depositosValidos.forEach(d => {
      if(depois(d.data, ctx.dataBase)){
        add('erro', 'matematica', 'O depósito judicial de ' + fmtData(d.data) + ' é posterior à data-base/pagamento — não é possível corrigi-lo corretamente.');
      }
    });
    ctx.levantamentos.forEach((l) => {
      if(!l.data || !l.valor) return;
      if(primeiraDataDeposito && antes(l.data, primeiraDataDeposito)){
        add('erro', 'matematica', 'Há um levantamento em ' + fmtData(l.data) + ' anterior à data do primeiro depósito (' + fmtData(primeiraDataDeposito) + ').');
      }
      if(depois(l.data, ctx.dataBase)){
        add('alerta', 'matematica', 'Há um levantamento em ' + fmtData(l.data) + ' posterior à data-base/pagamento — não interfere no cálculo atual.');
      }
    });
    if(ctx.levantamentos.some(l => (l.data && !l.valor) || (!l.data && l.valor))){
      add('alerta', 'matematica', 'Há uma linha de levantamento parcial incompleta (falta valor ou data).');
    }
    if(ctx.depositoCorrigido > ctx.totalAntesDeposito){
      add('alerta', 'matematica', 'O depósito corrigido supera o valor apurado antes da dedução — o total ficará negativo; confirme se este cenário é esperado.');
    }
  }
  if(ctx.existeDeposito && depositosValidos.length > 1){
    add('info', 'juridica', 'Há mais de um depósito judicial registrado, em datas diferentes: o saldo foi recalculado por segmentos (ver "Detalhamento do depósito"), somando cada novo depósito ao saldo já corrigido na data em que ele ocorreu.');
  }
  if(ctx.existeDeposito && ctx.levantamentos.some(l => l.data && l.valor)){
    add('info', 'juridica', 'Há levantamentos parciais registrados: o saldo do depósito foi recalculado por segmentos (ver "Detalhamento do depósito"), corrigindo o saldo até cada data de levantamento e deduzindo o valor então levantado antes de prosseguir a correção sobre o saldo remanescente.');
  }

  // --- NOVO: soma dos depósitos superior ao valor da condenação (sentença) ---
  if(ctx.existeDeposito && totalDepositado > 0 && ctx.valorSentenca > 0 && totalDepositado > ctx.valorSentenca){
    add('alerta', 'matematica', 'A soma dos depósitos judiciais (' + fmt(totalDepositado) + ') é superior ao valor da sentença/condenação (' + fmt(ctx.valorSentenca) + ') — confirme se os valores foram informados corretamente.');
  }

  // --- Levantamento superior ao saldo corrigido disponível NA DATA em que
  //     ele ocorreu (checagem por segmento, calculada em
  //     calcularDepositosComLevantamentos e repassada via ctx.avisosDeposito
  //     — mais precisa do que comparar a soma total com o saldo final,
  //     pois um levantamento intermediário pode já estourar o saldo mesmo
  //     que levantamentos posteriores "coubessem" no total). ---
  (ctx.avisosDeposito || []).forEach(msg => add('erro', 'matematica', msg));

  // --- Faixas de taxa por período (compensatórios e moratórios) ---
  const checarFaixas = (faixas, rotulo, exigivel) => {
    if(exigivel && faixas.length === 0){
      add('info', 'matematica', 'Nenhuma faixa de ' + rotulo + ' foi configurada.');
      return;
    }
    const resolvidas = faixas
      .map(f => ({ inicio: f.inicio || ctx.dataOferta, fim: f.fim || ctx.dataBase, taxa: parseFloat(f.taxa) || 0 }))
      .filter(f => f.inicio && f.fim)
      .sort((a, b) => new Date(a.inicio) - new Date(b.inicio));
    resolvidas.forEach((f) => {
      if(depois(f.inicio, f.fim)){
        add('erro', 'matematica', 'Uma faixa de ' + rotulo + ' tem início posterior ao fim (' + fmtData(f.inicio) + ' a ' + fmtData(f.fim) + ').');
      }
      if(!(f.taxa > 0)){
        add('alerta', 'matematica', 'Uma faixa de ' + rotulo + ' está com taxa zerada ou vazia (' + fmtData(f.inicio) + ' a ' + fmtData(f.fim) + ').');
      }
    });
    for(let i = 1; i < resolvidas.length; i++){
      const gap = (new Date(resolvidas[i].inicio) - new Date(resolvidas[i-1].fim)) / 86400000;
      if(gap > 1){
        add('alerta', 'matematica', 'Intervalo sem taxa configurada de ' + rotulo + ' entre ' + fmtData(resolvidas[i-1].fim) + ' e ' + fmtData(resolvidas[i].inicio) + ' (esse período não gera incidência).');
      }else if(gap < -1){
        add('alerta', 'matematica', 'Faixas de ' + rotulo + ' se sobrepõem entre ' + fmtData(resolvidas[i].inicio) + ' e ' + fmtData(resolvidas[i-1].fim) + ' — confirme se a dupla contagem é intencional.');
      }
    }
  };
  if(ctx.aplicarJurosComp) checarFaixas(ctx.faixasJurosComp, 'juros compensatórios', true);
  checarFaixas(ctx.faixasJurosMora, 'juros moratórios', false);

  // --- NOVO: juros moratórios sem termo inicial válido (nem faixa preenchida,
  //     nem data de oferta como referência de fallback) ---
  if(ctx.faixasJurosMora.some(f => !f.inicio && !ctx.dataOferta)){
    add('alerta', 'matematica', 'Há faixa de juros moratórios sem data de início e sem data de oferta preenchida para servir de referência — o termo inicial dessa faixa é indeterminado (' + (ctx.fundamentoJurosMora || 'confira o termo inicial aplicável ao caso') + ').');
  }

  // --- NOVO: data-base anterior à data da sentença ---
  if(depois(ctx.dataSentenca, ctx.dataBase)){
    add('erro', 'matematica', 'A data-base do cálculo (' + fmtData(ctx.dataBase) + ') é anterior à data da sentença (' + fmtData(ctx.dataSentenca) + ') — a data-base não pode retroagir a antes do título que se está calculando.');
  }

  // --- Resultado final ---
  if(ctx.total < 0){
    add('erro', 'matematica', 'O valor total devido ficou negativo — revise os valores antes de utilizar este demonstrativo.');
  }
  if(Math.abs(ctx.totalRecalculado - ctx.total) > 0.01){
    add('erro', 'matematica', 'Inconsistência interna no somatório do total detectada — não utilize este resultado; recalcule.');
  }

  /* ================ 2. INCONSISTÊNCIA JURÍDICA/METODOLÓGICA ================ */
  // A composição dos encargos pode "fechar" matematicamente e ainda assim
  // ser incompatível com o regime legal do período — checagens abaixo.

  // --- Índice de correção "conforme sentença" sem transcrição do trecho:
  //     é uma lacuna probatória/metodológica, não um erro de conta. ---
  if(ctx.indiceRaw === 'sentenca' && !ctx.trechoSentencaIndice){
    add('alerta', 'juridica', 'Índice definido como "conforme sentença", mas o trecho da decisão não foi transcrito (Art. 3º) — recomendável preencher para fins probatórios.');
  }

  // --- Juros compensatórios sem faixa configurada: usa fallback de 12% a.a.
  //     sem que o usuário tenha decidido isso conscientemente. Essa taxa é
  //     historicamente correta até 13/09/2001, mas tornou-se controvertida
  //     para períodos mais recentes após o julgamento de mérito da ADI
  //     2.332/STF (2018) e o cancelamento da Súmula 408/STJ (28/10/2020). ---
  if(ctx.aplicarJurosComp && ctx.faixasJurosComp.length === 0 && ctx.dataImissao){
    if(!ctx.permitirFallback12){
      // CORREÇÃO (revisão pericial — uso profissional): sem faixa
      // configurada e sem o opt-in do fallback de 12%, o cálculo NÃO
      // aplica nenhuma taxa automaticamente (ver calcularJurosCompensatorios)
      // — isto é um ERRO bloqueante, não mais um alerta, pois o total
      // exportado estaria incompleto (juros compensatórios = R$ 0,00) sem
      // que isso fique claro apenas lendo o resumo.
      add('erro', 'juridica', 'Juros compensatórios marcados para aplicação, mas nenhuma faixa de taxa foi configurada e o fallback automático de 12% a.a. está desativado (padrão para uso profissional, pois esse percentual é controvertido para imissões recentes — ADI 2.332/STF, 2018, e cancelamento da Súmula 408/STJ, 28/10/2020). Configure explicitamente ao menos uma faixa de taxa (Art. 2º) antes de calcular. Nenhum valor de juros compensatórios foi somado ao total.');
    }else{
      add('alerta', 'juridica', 'Juros compensatórios sem faixa de taxa configurada: por opção explícita, o sistema aplica 12% a.a. para todo o período (referência histórica da Súmula 618/STF), mas esse percentual é controvertido para imissões mais recentes — o julgamento de mérito da ADI 2.332/STF (2018) e o cancelamento da Súmula 408/STJ (28/10/2020, Pet 12.344/DF) tornaram o tema sem taxa pacificada nos últimos anos. Prefira configurar faixas explícitas por período em vez de depender do valor padrão.');

      // CORREÇÃO (revisão pericial, achado 2.6): o fallback de 12% a.a. não
      // modela o período em que a taxa foi legalmente 6% a.a. (MP 1.577/97,
      // de 11/06/1997 a 13/09/2001). Se a imissão for anterior a 1997 ou o
      // período cruzar essa janela, alerta especificamente sobre isso, em vez
      // de deixar o usuário descobrir por conta própria.
      const JANELA_MP1577_INICIO = '1997-06-11';
      const JANELA_MP1577_FIM = '2001-09-13';
      if(ctx.dataImissao <= JANELA_MP1577_FIM && ctx.dataBase >= JANELA_MP1577_INICIO){
        add('alerta', 'juridica', 'O período de incidência dos juros compensatórios cruza a janela de 11/06/1997 a 13/09/2001, em que a taxa foi legalmente fixada em 6% a.a. (MP 1.577/97). O fallback automático desta calculadora aplica 12% a.a. ao período inteiro, sem recortar essa janela — para refletir corretamente o regime histórico, configure faixas explícitas de taxa cobrindo separadamente o período de 6% a.a. e os demais.');
      }
    }
  }

  // --- Índice "conforme sentença" + troca automática para Selic (EC113):
  //     a sentença já determinou o índice tecnicamente aplicável; ligar a
  //     troca automática pode substituir, sem aviso, um critério que o
  //     próprio título judicial fixou (ou pode ser exatamente o que a
  //     sentença já prevê — mas isso não pode ser presumido pelo sistema). ---
  if(ctx.indiceRaw === 'sentenca' && ctx.aplicarEC113){
    add('alerta', 'juridica', 'O índice de correção foi definido como "conforme sentença", mas a troca automática para Selic a partir da EC 113/2021 também está ativada. Confirme se a própria sentença já prevê essa transição — do contrário, a calculadora pode estar aplicando, a partir de 12/2021, um critério diferente do efetivamente determinado no título judicial.');
  }

  // --- Transparência sobre o recorte de juros moratórios feito para evitar
  //     dupla incidência com a Selic (ver calcularJurosMoratorios). Isso já
  //     está descrito na memória de cálculo, mas também é sinalizado aqui,
  //     como decisão metodológica que o usuário deve validar, não apenas
  //     como nota de rodapé no relatório. ---
  if(ctx.houveRecortePeriodoInteiro){
    add('info', 'juridica', 'Os juros moratórios configurados não foram aplicados: a Selic foi escolhida como índice de correção para todo o período e, por si só, já embute juros (art. 1º-F da Lei 9.494/97). Confirme se essa é de fato a interpretação pretendida para o caso.');
  }else if(ctx.houveRecorteEC113){
    add('info', 'juridica', 'A partir de 12/2021, os juros moratórios configurados foram recortados/desconsiderados nesse trecho, pois a correção já passa a rodar pela Selic (EC 113/2021), que já embute juros de mora. Confirme se essa transição está de acordo com a fundamentação usada no processo.');
  }

  // --- Fundamento de juros compensatórios incompatível com o tipo de ação:
  //     ação indireta usa Súmula 69/STJ (efetiva ocupação); ação direta usa
  //     Súmula 408/STJ (imissão provisória). O sistema já escolhe o rótulo
  //     certo automaticamente — aqui só se confirma que há uma data de
  //     imissão/ocupação coerente com o tipo escolhido. ---
  if(ctx.aplicarJurosComp && !ctx.dataImissao){
    add('alerta', 'juridica', 'Juros compensatórios marcados para aplicação, mas sem data de imissão/ocupação informada — nenhum valor será calculado até que essa data seja preenchida (Art. 2º).');
  }

  // --- NOVO: diferença negativa entre sentença e oferta — antes o sistema
  //     zerava silenciosamente (Math.max(0, ...)); agora o valor negativo é
  //     mantido e sinalizado aqui como erro para revisão manual, em vez de
  //     ser mascarado. ---
  if(ctx.diferenca < 0){
    add('erro', 'juridica', 'O valor da sentença é inferior ao valor da oferta — diferença negativa (' + fmt(ctx.diferenca) + '). O sistema NÃO está zerando esse valor automaticamente; confirme se os valores de oferta/sentença foram informados corretamente antes de prosseguir, pois isso é juridicamente atípico.');
  }

  // --- NOVO: índice descrito como vindo da sentença, mas o campo "Índice"
  //     não está configurado como "conforme sentença" — provável
  //     incompatibilidade entre o que foi transcrito e o índice efetivamente
  //     aplicado no cálculo. ---
  if(ctx.trechoSentencaIndice && ctx.indiceRaw !== 'sentenca'){
    add('alerta', 'juridica', 'Há um trecho da sentença sobre o índice de correção transcrito, mas o índice selecionado no cálculo não é "conforme sentença" — confirme se o índice efetivamente usado é compatível com o que a sentença determinou.');
  }

  // --- NOVO (revisão pericial, achado 2.1): correção monetária resultou em
  //     zero meses de incidência apesar de haver diferença relevante a
  //     corrigir. Isso pode ser legítimo (datas realmente coincidentes), mas
  //     também pode ser sintoma de falta da data-âncora correta para este
  //     tipo de ação (ver configTipoAcao().rotuloAncoraCorrecao) — like
  //     antes acontecia silenciosamente sempre que 'Data da oferta' ficava
  //     em branco nos tipos que não têm oferta. ---
  if(Math.abs(ctx.diferenca) > 0.01 && ctx.mesesCorrecao === 0){
    add('alerta', 'juridica', 'A correção monetária resultou em zero meses de incidência (R$ 0,00 corrigido), apesar de haver diferença apurada de ' + fmt(ctx.diferenca) + '. Confira se a data-âncora da correção está preenchida corretamente — para este tipo de ação, a referência esperada é: ' + (ctx.rotuloAncoraCorrecao || 'defina manualmente') + '.');
  }

  // --- NOVO: percentual de honorários acima do limite configurado pelo
  //     usuário (campo opcional — só valida quando um limite é informado;
  //     o sistema não presume um teto legal fixo, pois este varia conforme
  //     o caso — CPC, art. 85, §§2º a 8º). ---
  if(ctx.limiteHonorPercentual > 0 && ctx.percentualHonor > ctx.limiteHonorPercentual){
    add('alerta', 'juridica', 'O percentual de honorários configurado (' + ctx.percentualHonor.toFixed(2).replace('.', ',') + '%) é maior do que o limite informado (' + ctx.limiteHonorPercentual.toFixed(2).replace('.', ',') + '%) — confirme se o percentual está de acordo com o CPC, art. 85, e com o entendimento aplicável ao caso.');
  }

  if(itens.length === 0){
    add('ok', 'matematica', 'Nenhuma inconsistência encontrada nas verificações automáticas.');
  }
  return itens;
}/* ------------------------------------------------------------------------
   3. JUROS COMPENSATÓRIOS
   Soma a contribuição de cada faixa de período configurada (cada uma com
   sua própria taxa % a.a.). Se nenhuma faixa tiver sido configurada, usa
   uma faixa implícita única (imissão até a data-base, 12% a.a. —
   referência histórica da Súmula 618/STF) como comportamento padrão de
   segurança.

   DEPENDÊNCIA EXTERNA AINDA NÃO MODULARIZADA: chama coletarFaixasJurosComp()
   e ehTipoAcaoIndireta() (esta última definida acima, na seção 1). A
   primeira ainda vive no arquivo original (gerenciador de linhas dinâmicas
   do formulário) — precisa estar carregada no mesmo contexto.
------------------------------------------------------------------------ */
// CORREÇÃO (revisão pericial — uso profissional, achado 3): antes, a
// ausência de qualquer faixa configurada SEMPRE recaía, silenciosamente,
// no fallback de 12% a.a. (Súmula 618/STF) para todo o período. Isso é
// arriscado num contexto de escritório: um esquecimento de preenchimento
// virava um percentual aplicado sem que ninguém tivesse decidido isso
// conscientemente — e o próprio código já reconhecia (nos alertas de
// auditarCalculo) que esse percentual é controverso para períodos
// recentes (ADI 2.332/STF, cancelamento da Súmula 408/STJ).
// AGORA: o fallback de 12% só é aplicado se `permitirFallback12` for
// explicitamente true (checkbox de opt-in, desmarcada por padrão — ver
// index.html/completar.js). Sem isso, a função devolve total=0 e sinaliza
// `bloqueadoSemFaixa: true`, para que auditarCalculo() transforme a
// ausência de faixa em ERRO bloqueante (e não mais um mero alerta),
// exigindo que o usuário configure explicitamente ao menos uma faixa.
function calcularJurosCompensatorios(baseJurosComp, dataImissao, dataBase, criterio, permitirFallback12){
  let faixas = coletarFaixasJurosComp();
  if(faixas.length === 0 && dataImissao){
    if(!permitirFallback12){
      return { total: 0, desc: '—', bloqueadoSemFaixa: true };
    }
    faixas = [{ inicio: dataImissao, fim: '', taxa: '12' }];
  }
  let total = 0;
  const partes = [];
  faixas.forEach(f => {
    const inicio = f.inicio || dataImissao;
    const fim = f.fim || dataBase;
    if(!inicio || !fim) return;
    const periodo = contarPeriodo(inicio, fim, criterio);
    if(!periodo || !(periodo.fracaoAno > 0)) return;
    const taxa = parseFloat(f.taxa) || 0;
    total += baseJurosComp * (taxa / 100) * periodo.fracaoAno;
    partes.push(taxa.toFixed(2).replace('.', ',') + '% a.a. de ' + fmtData(inicio) + ' a ' + fmtData(fim) + ' (' + periodo.desc + ')');
  });
  // CORREÇÃO: o fundamento passou a vir de configTipoAcao().fundamentoJurosComp
  // (já registrado por modulos/direta.js e modulos/indireta.js) em vez de ser
  // decidido de novo aqui via ehTipoAcaoIndireta(). Evita ter a mesma
  // informação jurídica definida em dois lugares que podiam divergir.
  const fundamento = configTipoAcao().fundamentoJurosComp
    || 'Fundamento de juros compensatórios não definido para este tipo de ação — confira manualmente antes de usar o resultado.';
  const desc = partes.length ? (partes.join('; ') + ' — sobre o valor da indenização corrigido (' + fundamento + ')') : '—';
  return { total, desc };
}

/* ------------------------------------------------------------------------
   4A2. DEPÓSITO(S) JUDICIAL(IS) COM LEVANTAMENTOS PARCIAIS
   CORREÇÃO (revisão pericial — uso profissional, achado 3, maior limitação
   técnica apontada): antes, levantamentos parciais eram só informativos —
   o depósito era corrigido de uma vez (data do depósito até a data-base)
   e os levantamentos não alteravam nem o saldo nem a correção/juros.
   AGORA (v6.1 — checklist "Depósitos em várias datas"): a função aceita uma
   LISTA de depósitos (não apenas um), permitindo, por exemplo, um depósito
   inicial seguido de depósito(s) complementar(es) em datas posteriores —
   além da lista de levantamentos já suportada. Os dois tipos de evento
   (depósito soma, levantamento subtrai) são intercalados numa única linha
   do tempo, ordenada por data:
     depósito 1 -> [levantamento?] -> [depósito 2?] -> ... -> data-base
   Em cada segmento entre dois eventos consecutivos (ou entre o último
   evento e a data-base), o saldo então existente é corrigido pelo mesmo
   índice da correção principal (montarMemoriaCorrecao, de indices.js) até
   a data do evento seguinte; ao chegar no evento, o valor NOMINAL respectivo
   é somado (depósito) ou subtraído (levantamento) do saldo já corrigido —
   isto é, tanto o depósito complementar quanto o levantamento passam a
   efetivamente alterar o saldo e a base de incidência da correção/juros a
   partir daquela data, em vez de ficarem só anotados.
   Em caso de empate na mesma data, depósitos são processados antes de
   levantamentos (o numerário só pode ser levantado depois de disponível).
   Retorna também `avisos` (levantamento maior que o saldo corrigido
   disponível naquela data) para a auditoria sinalizar como erro.
   DEPENDE de montarMemoriaCorrecao (indices.js) já carregado.
------------------------------------------------------------------------ */
async function calcularDepositosComLevantamentos(depositos, dataBaseCalc, indice, taxaManual, incluirMesInicial, aplicarEC113, levantamentos){
  const depositosValidos = (depositos || [])
    .filter(d => d.data && d.valor > 0)
    .sort((a, b) => a.data.localeCompare(b.data));

  if(depositosValidos.length === 0){
    return { depositoCorrigido: 0, detalhamento: [], avisos: [] };
  }

  const primeiraData = depositosValidos[0].data;
  const levantamentosValidos = (levantamentos || [])
    .filter(l => l.data && l.valor > 0 && l.data >= primeiraData && l.data <= dataBaseCalc)
    .sort((a, b) => a.data.localeCompare(b.data));

  // Linha do tempo unificada: cada depósito soma, cada levantamento subtrai.
  // Empate na mesma data -> depósito processado antes do levantamento.
  const eventos = [
    ...depositosValidos.map(d => ({ data: d.data, tipo: 'deposito', valor: d.valor })),
    ...levantamentosValidos.map(l => ({ data: l.data, tipo: 'levantamento', valor: l.valor }))
  ].sort((a, b) => {
    if(a.data !== b.data) return a.data < b.data ? -1 : 1;
    if(a.tipo === b.tipo) return 0;
    return a.tipo === 'deposito' ? -1 : 1;
  });

  // O primeiro evento da linha do tempo é sempre um depósito (o mais antigo
  // — depositosValidos está ordenado e levantamentos nunca são anteriores a
  // ele, ver filtro acima). Ele define o saldo de ABERTURA, não um "evento"
  // dentro de um segmento — por isso não gera uma linha de detalhamento
  // degenerada (início = fim = a própria data do depósito).
  let saldo = eventos[0].valor;
  let dataAtual = eventos[0].data;
  const detalhamento = [];
  const avisos = [];

  for(let i = 1; i < eventos.length; i++){
    const ev = eventos[i];
    let saldoCorrigido = saldo;
    if(ev.data > dataAtual && saldo > 0){
      const { memoria } = await montarMemoriaCorrecao(saldo, dataAtual, ev.data, indice, taxaManual, incluirMesInicial, aplicarEC113);
      saldoCorrigido = memoria.length ? memoria[memoria.length - 1].valorCorrigido : saldo;
    }
    let saldoResultante;
    if(ev.tipo === 'deposito'){
      saldoResultante = saldoCorrigido + ev.valor;
    }else{
      saldoResultante = saldoCorrigido - ev.valor;
      if(saldoResultante < 0){
        avisos.push('O levantamento de ' + fmtData(ev.data) + ' (' + fmt(ev.valor) + ') é maior do que o saldo do depósito já corrigido até aquela data (' + fmt(saldoCorrigido) + ').');
      }
    }
    detalhamento.push({
      inicio: dataAtual, fim: ev.data, saldoInicial: saldo, saldoCorrigido,
      evento: ev.tipo, valorEvento: ev.valor, saldoRemanescente: saldoResultante
    });
    saldo = saldoResultante;
    dataAtual = ev.data;
  }

  // Segmento final: do último evento até a data-base.
  let saldoFinal = saldo;
  if(dataBaseCalc > dataAtual && saldo > 0){
    const { memoria } = await montarMemoriaCorrecao(saldo, dataAtual, dataBaseCalc, indice, taxaManual, incluirMesInicial, aplicarEC113);
    saldoFinal = memoria.length ? memoria[memoria.length - 1].valorCorrigido : saldo;
    detalhamento.push({
      inicio: dataAtual, fim: dataBaseCalc, saldoInicial: saldo, saldoCorrigido: saldoFinal,
      evento: null, valorEvento: 0, saldoRemanescente: saldoFinal
    });
  }

  return { depositoCorrigido: saldoFinal, detalhamento, avisos };
}

/* ------------------------------------------------------------------------
   4B. BASE DE CÁLCULO DOS HONORÁRIOS
   CORREÇÃO: antes, completar.js calculava a base de honorários com uma
   única fórmula fixa para todos os tipos de ação (diferença + correção +
   juros), ignorando o campo `baseHonorariosPadrao` que MOTORES_TIPO_ACAO já
   define para cada tipo. Esta função passa a efetivamente consumir esse
   campo, escolhendo a base correta conforme o tipo de ação configurado:
     - 'diferenca_oferta_sentenca' (desapropriação direta, Súmula 141/STJ):
       base = diferença (sentença − oferta) corrigida + juros.
     - 'valor_total_indenizacao' (desapropriação indireta): base = valor
       total da indenização (não há "oferta" para comparar) + benfeitorias,
       corrigido + juros.
     - 'valor_titulo' / 'valor_principal' (execução, cobrança): base =
       valor do título/principal corrigido + juros de mora (sem juros
       compensatórios, que não se aplicam a esses tipos).
     - qualquer valor não mapeado: cai no mesmo cálculo de
       'diferenca_oferta_sentenca', como comportamento de segurança.
------------------------------------------------------------------------ */
function calcularBaseHonoraria(baseHonorariosPadrao, partes){
  const { diferenca, valorSentenca, valorBenfeitorias, correcao, jurosCompTotal, jurosMoraTotal } = partes;
  switch(baseHonorariosPadrao){
    case 'valor_total_indenizacao':
      return valorSentenca + valorBenfeitorias + correcao + jurosCompTotal + jurosMoraTotal;
    case 'valor_titulo':
    case 'valor_principal':
      return valorSentenca + correcao + jurosMoraTotal;
    case 'diferenca_oferta_sentenca':
    default:
      return diferenca + correcao + jurosCompTotal + jurosMoraTotal;
  }
}

/* ------------------------------------------------------------------------
   4. JUROS MORATÓRIOS
   Calcula os juros moratórios somando a contribuição de cada faixa de
   período configurada, sobre a diferença (sentença − oferta) já somada às
   benfeitorias — base fixa, sem correção monetária. Mesma base usada pela
   correção monetária e pelos juros compensatórios (achado 2.4 da revisão
   pericial: antes as benfeitorias ficavam de fora só aqui).
   Sem nenhuma faixa configurada, não há incidência (0).

   Evita a dupla incidência entre correção monetária e juros moratórios
   quando a correção já está sendo feita pela Selic — índice que, por si só,
   já embute juros (art. 1º-F da Lei 9.494/97 e, a partir de 12/2021, EC
   113/2021). Há dois cenários distintos, com recortes diferentes:
    - indiceSelicPeriodoInteiro: a Selic foi escolhida diretamente como
      índice de correção para TODO o período — o embutimento de juros vale
      do início ao fim, então nenhuma faixa de juros moratórios é aplicada.
    - usaSwitchEC113: a correção só passa a usar Selic a partir de 12/2021
      (troca automática da EC 113/2021), permanecendo o índice originalmente
      escolhido antes disso — logo, só o trecho a partir de 12/2021 de cada
      faixa de juros moratórios é recortado/zerado.

   DEPENDÊNCIA EXTERNA AINDA NÃO MODULARIZADA: chama coletarFaixasJurosMora(),
   no mesmo molde de coletarFaixasJurosComp() acima.
------------------------------------------------------------------------ */
// Competência de corte da EC 113/2021 usada especificamente para os juros
// moratórios (mesmo marco de 12/2021 já usado na correção monetária).
const EC113_CORTE_ISO = '2021-12-01';

function calcularJurosMoratorios(baseValor, dataInicioPadrao, dataBase, opts){
  opts = opts || {};
  const indiceSelicPeriodoInteiro = !!opts.indiceSelicPeriodoInteiro;
  const usaSwitchEC113 = !!opts.usaSwitchEC113;
  const criterio = opts.criterio;
  const faixas = coletarFaixasJurosMora();
  if(faixas.length === 0){
    return { total: 0, desc: '—' };
  }
  let total = 0;
  const partes = [];
  let houveRecortePeriodoInteiro = false;
  let houveRecorteEC113 = false;
  faixas.forEach(f => {
    const inicio = f.inicio || dataInicioPadrao;
    let fim = f.fim || dataBase;
    if(!inicio || !fim) return;

    if(indiceSelicPeriodoInteiro){
      // Selic já cobre juros do início ao fim: faixa inteira desconsiderada.
      houveRecortePeriodoInteiro = true;
      return;
    }

    if(usaSwitchEC113 && fim > EC113_CORTE_ISO){
      if(inicio >= EC113_CORTE_ISO){
        houveRecorteEC113 = true;
        return; // faixa inteira já coberta pela Selic (EC 113/2021) — sem juros de mora aqui
      }
      fim = EC113_CORTE_ISO;
      houveRecorteEC113 = true;
    }

    const periodo = contarPeriodo(inicio, fim, criterio);
    if(!periodo || !(periodo.fracaoAno > 0)) return;
    const taxa = parseFloat(f.taxa) || 0;
    total += baseValor * (taxa / 100) * periodo.fracaoAno;
    partes.push(taxa.toFixed(2).replace('.', ',') + '% a.a. de ' + fmtData(inicio) + ' a ' + fmtData(fim) + ' (' + periodo.desc + ')');
  });
  let desc;
  if(houveRecortePeriodoInteiro){
    desc = 'Não aplicados: a Selic foi escolhida como índice de correção para todo o período e já embute os juros de mora (art. 1º-F da Lei 9.494/97) — somá-los à parte geraria dupla incidência.';
  }else{
    desc = partes.length ? (partes.join('; ') + ' — sobre a diferença apurada (incluindo benfeitorias, quando houver)') : '—';
    if(houveRecorteEC113){
      desc += ' · a partir de 12/2021 os juros de mora não são somados à parte: já estão embutidos na correção pela Selic (EC 113/2021), evitando dupla incidência.';
    }
  }
  return { total, desc, houveRecortePeriodoInteiro, houveRecorteEC113 };
}
