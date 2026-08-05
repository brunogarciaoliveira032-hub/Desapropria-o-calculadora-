/* ============================================================================
   MODULOS/INDIRETA.JS — Regras específicas da Desapropriação indireta /
   Indenização por apossamento administrativo

   Mesmo padrão de modulos/direta.js: código novo (não extração 1:1), que
   isola a config de 'indenizacao' — antes hardcoded em MOTORES_TIPO_ACAO,
   dentro de motor.js — e a registra via registrarTipoAcao(). motor.js já
   foi ajustado para não conter mais esta entrada (ver ATUALIZAÇÃO no
   cabeçalho de motor.js).

   CONTEÚDO (idêntico, campo a campo, à antiga entrada 'indenizacao' de
   MOTORES_TIPO_ACAO — nenhuma regra jurídica nova, só isolada aqui):
     - Config de negócio da desapropriação indireta: não exige oferta nem
       depósito prévio (não há imissão provisória formal), permite juros
       compensatórios (Súmula 69/STJ, desde a efetiva ocupação), honorários
       sobre o valor total da indenização (não há "oferta" para comparar,
       diferente da via direta).

   DEPENDE de:
     - js/motor.js carregado ANTES deste módulo — precisa que
       MOTORES_TIPO_ACAO, NOMES_TIPO_ACAO e registrarTipoAcao() já existam.
============================================================================ */

// Mesmo padrão de modulos/direta.js: registro isolado em try...catch. O
// <option value="indenizacao"> já está fixo no HTML independente deste
// script, mas o CÁLCULO da via indireta depende de MOTORES_TIPO_ACAO ter
// essa chave. Um erro aqui fica contido neste módulo — não derruba os
// scripts carregados depois — e configTipoAcao() (motor.js) cai sozinho no
// fallback 'outro' se 'indenizacao' não estiver registrada, então o
// usuário ainda consegue calcular (com config genérica) em vez de a
// aplicação travar.
try{
  const CONFIG_INDIRETA = {
    label: 'Desapropriação indireta / Indenização por apossamento',
    exigeOferta: false,
    exigeDepositoPossivel: false,
    permiteJurosCompensatorios: true,
    // CORREÇÃO (revisão pericial): a correção monetária estava ancorada em
    // 'dataOferta' para todos os tipos de ação — campo que a via indireta não
    // tem (ver exigeOferta acima). Como o campo fica em branco, o resultado
    // era correção R$ 0,00 sem nenhum aviso. O ideal, tecnicamente, é ancorar
    // na data da avaliação/laudo (Súmula 561/STF), mas o formulário ainda não
    // tem um campo próprio para isso — usa-se aqui a data de efetiva ocupação
    // (mesmo campo/data já usado para os juros compensatórios, Súmula 69/STJ)
    // como proxy razoável, sinalizado no rótulo abaixo. PENDÊNCIA: criar campo
    // dedicado de "data da avaliação/laudo" quando o formulário for revisado.
    campoAncoraCorrecao: 'dataImissao',
    rotuloAncoraCorrecao: 'Data da efetiva ocupação (proxy — idealmente seria a data da avaliação/laudo, Súmula 561/STF)',
    fundamentoJurosComp: 'Súmula 69/STJ',
    rotuloTermoInicialJurosComp: 'Data da efetiva ocupação (apossamento administrativo)',
    notaTermoInicialJurosComp: 'Marco legal da desapropriação indireta — não há imissão provisória formal; use a data em que o Poder Público efetivamente ocupou/apossou-se do imóvel (Súmula 69/STJ) — Art. 4º. A correção monetária, em regra, corre desde a data da avaliação/laudo (Súmula 561/STF).',
    baseHonorariosPadrao: 'valor_total_indenizacao',
    fundamentoHonorarios: 'Não há "oferta" na via indireta — a Súmula 141/STJ é específica da desapropriação direta. Em regra os honorários incidem sobre o valor total da indenização/diferença apurada em relação ao que já foi eventualmente pago administrativamente.',
    fundamentoJurosMora: 'em regra, desde a citação — confirme o termo fixado no título/sentença do seu caso',
    avisoCategoria: null
  };

  registrarTipoAcao('indenizacao', 'Desapropriação indireta / Indenização por apossamento', CONFIG_INDIRETA);
}catch(erro){
  console.error('[modulos/indireta.js] Falha ao registrar o tipo de ação "Desapropriação indireta":', erro);
  try{
    toast('Falha ao carregar as regras de "Desapropriação indireta" — o cálculo usará uma config genérica. Veja o console.', true);
  }catch(e){ /* toast()/elemento #toast indisponível — não é crítico, só não avisa visualmente */ }
}
