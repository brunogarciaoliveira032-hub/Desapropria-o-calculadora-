/* ============================================================================
   CARREGADOR.JS — Carregamento dinâmico dos módulos por tipo de ação

   ATENÇÃO: diferente dos demais arquivos já extraídos (util.js, motor.js,
   indices.js, exportarPDF.js, exportarExcel.js), este arquivo é CÓDIGO NOVO,
   não uma extração do HTML original — no HTML de origem não existe nenhuma
   lógica de carregamento dinâmico de módulos ainda (tudo está inline num
   único <script>). Este arquivo antecipa a infraestrutura de carregamento
   para quando a lógica específica de cada tipo de ação for de fato separada
   em /modulos/*.js, conforme a árvore de arquivos combinada.

   OBJETIVO
   Carregar sob demanda (e só uma vez) o módulo de /modulos/ correspondente
   ao tipo de ação selecionado no formulário (#tipoAcao), em vez de incluir
   os 6 arquivos de módulo via <script src="..."> fixos no index.html. Isso
   evita baixar/parsear regras jurídicas de tipos de ação que o usuário não
   está usando no momento.

   MAPEAMENTO ATUAL (tipoAcao -> módulo)
   O <select id="tipoAcao"> do HTML hoje só tem 5 valores: desapropriacao,
   indenizacao, execucao, cobranca, outro — nenhum deles chamado
   "servidao"/"imissao"/"retrocessao"/"rural". A árvore de arquivos já prevê
   6 módulos (direta, indireta, servidao, imissao, retrocessao, rural), então
   o mapeamento abaixo é uma PROPOSTA a validar com você:
     - desapropriacao -> modulos/direta.js
     - indenizacao    -> modulos/indireta.js
     - execucao       -> sem módulo próprio ainda (usa só motor.js/config
                          genérica); ver aviso em MOTORES_TIPO_ACAO.execucao
     - cobranca        -> sem módulo próprio ainda (idem)
     - outro           -> sem módulo (não há regra jurídica específica)
   servidao.js, imissao.js e retrocessao.js e rural.js ainda não têm valor
   correspondente no <select> nem foram escritos — por ora o carregador
   sabe carregá-los pelo nome (função genérica), mas nada no formulário os
   aciona ainda. PENDENTE: decidir juntos se/quando esses 4 tipos entram
   como novas <option> em #tipoAcao.

   DEPENDE de:
     - js/util.js: $ (seleção de DOM).
   É ESPERADO rodar DEPOIS de util.js e ANTES de motor.js/indices.js, pois
   os módulos de /modulos/ devem poder consumir configTipoAcao() etc. quando
   essa lógica for de fato movida para lá (ver pendência em motor.js).

   COMPORTAMENTO
     - Cada módulo é injetado via <script src="modulos/<nome>.js"> apenas na
       primeira vez em que é necessário (cache em MODULOS_CARREGADOS).
     - carregarModuloTipoAcao(tipoAcao) devolve uma Promise que resolve
       quando o módulo termina de carregar (ou resolve imediatamente se o
       tipo de ação não tiver módulo próprio, ou já tiver sido carregado).
     - Falha de rede/arquivo ausente rejeita a Promise com um Error — quem
       chamar deve tratar (ex.: toast de erro), sem travar o restante do
       app: os cálculos que não dependem do módulo específico continuam
       funcionando com o que já está em motor.js.
============================================================================ */

/* ------------------------------------------------------------------------
   1. MAPEAMENTO tipoAcao -> arquivo de módulo
------------------------------------------------------------------------ */
const MODULOS_TIPO_ACAO = {
  desapropriacao: 'direta',
  indenizacao: 'indireta'
  // execucao, cobranca e outro: sem módulo próprio por ora (propositalmente
  // ausentes do mapa — ver cabeçalho acima).
  // servidao / imissao / retrocessao / rural: módulos previstos na árvore
  // de arquivos, ainda sem <option> correspondente em #tipoAcao. Assim que
  // existirem, basta acrescentar aqui, ex.: servidaoAdministrativa: 'servidao'.
};

/* ------------------------------------------------------------------------
   2. CACHE E INJEÇÃO DE <script>
------------------------------------------------------------------------ */
// Guarda, por nome de módulo, a Promise da carga em andamento/concluída —
// evita reinjetar <script> se o mesmo módulo for pedido mais de uma vez
// (ex.: usuário alterna entre "Desapropriação (direta)" e outro tipo e
// depois volta).
const MODULOS_CARREGADOS = {};

function carregarScriptModulo(nomeModulo){
  if(MODULOS_CARREGADOS[nomeModulo]) return MODULOS_CARREGADOS[nomeModulo];

  const promessa = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'modulos/' + nomeModulo + '.js';
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => {
      reject(new Error('Não foi possível carregar o módulo "' + nomeModulo + '.js" (verifique se o arquivo existe em /modulos/ e sua conexão com a internet).'));
    });
    document.head.appendChild(script);
  });

  MODULOS_CARREGADOS[nomeModulo] = promessa;
  return promessa;
}

/* ------------------------------------------------------------------------
   3. API PÚBLICA: carregar o módulo do tipo de ação selecionado
------------------------------------------------------------------------ */
// Chamar antes de calcular()/gerarPdf()/exportarExcel() quando o tipo de
// ação tiver módulo próprio (ver MODULOS_TIPO_ACAO acima). Tipos de ação
// sem módulo resolvem a Promise imediatamente, sem round-trip de rede.
function carregarModuloTipoAcao(tipoAcao){
  const nomeModulo = MODULOS_TIPO_ACAO[tipoAcao];
  if(!nomeModulo) return Promise.resolve(null);
  return carregarScriptModulo(nomeModulo);
}
