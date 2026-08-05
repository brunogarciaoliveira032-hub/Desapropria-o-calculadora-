/* ============================================================================
   CONSULTAOAB.JS — Preenchimento automático do Advogado(a) a partir da OAB

   OBJETIVO
   Quando o usuário sai do campo OAB (#advogadoOAB) e o campo Advogado(a)
   (#advogadoNome) ainda está vazio, tenta buscar o nome do(a) advogado(a)
   automaticamente e preencher o campo — só isso; nunca sobrescreve um nome
   já digitado manualmente.

   PROVEDOR
   Não existe API pública oficial da OAB para isso (o Cadastro Nacional de
   Advogados — cna.oab.org.br — é só um formulário web, sem endpoint aberto).
   Este arquivo chama, por padrão, a API paga da Exato Digital
   (https://api.exato.digital/oab/cadastro-nacional-advogados), que exige um
   token próprio (ver bloco "Consulta automática de advogado pela OAB" no
   formulário). Se você usa outro provedor, troque só a função
   `chamarProvedorConsultaOab` abaixo — o resto (armazenamento do token,
   parsing do campo OAB, preenchimento do campo) não muda.

   ATENÇÃO: chamada feita direto do navegador. Se o provedor não liberar
   CORS para chamadas client-side, a consulta falha silenciosamente (cai no
   preenchimento manual) — nesse caso normalmente é preciso um backend
   intermediário, o que este app (sem servidor próprio) não tem hoje.

   PRIVACIDADE: o token fica só no localStorage deste navegador; nunca é
   enviado a ninguém além do provedor de consulta configurado.

   DEPENDE de:
     - js/util.js: $ (seleção de DOM), toast().
   É ESPERADO rodar depois de util.js.
============================================================================ */

const CHAVE_LOCALSTORAGE_TOKEN_OAB = 'calcDesapropriacao.tokenApiOab';

/* ------------------------------------------------------------------------
   1. TOKEN (armazenado só no localStorage deste navegador)
------------------------------------------------------------------------ */
function obterTokenApiOab(){
  try{ return localStorage.getItem(CHAVE_LOCALSTORAGE_TOKEN_OAB) || ''; }catch(e){ return ''; }
}

function salvarTokenApiOab(token){
  try{
    const limpo = (token || '').trim();
    if(limpo) localStorage.setItem(CHAVE_LOCALSTORAGE_TOKEN_OAB, limpo);
    else localStorage.removeItem(CHAVE_LOCALSTORAGE_TOKEN_OAB);
    return true;
  }catch(e){
    toast('Não foi possível salvar o token neste navegador (armazenamento local indisponível).', true);
    return false;
  }
}

/* ------------------------------------------------------------------------
   2. PARSING DO CAMPO OAB (ex.: "OAB/SP 123.456" -> { seccional: 'SP', numero: '123456' })
------------------------------------------------------------------------ */
function interpretarCampoOab(valorCampo){
  const valor = (valorCampo || '').trim();
  const mSeccional = valor.match(/\/?\s*([A-Za-z]{2})\b/);
  const seccional = mSeccional ? mSeccional[1].toUpperCase() : '';
  const numero = valor.replace(/\D/g, '');
  return { seccional, numero };
}

/* ------------------------------------------------------------------------
   3. CHAMADA AO PROVEDOR DE CONSULTA
   Troque aqui se usar outro provedor. Deve devolver o nome do(a)
   advogado(a) (string) ou lançar um Error com uma mensagem amigável.
------------------------------------------------------------------------ */
async function chamarProvedorConsultaOab(numero, seccional, token){
  const resposta = await fetch('https://api.exato.digital/oab/cadastro-nacional-advogados', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ numero_inscricao: numero, seccional, tipo_inscricao: 0, token })
  });

  if(!resposta.ok){
    throw new Error('Provedor de consulta OAB retornou erro (HTTP ' + resposta.status + ').');
  }
  const dados = await resposta.json();
  const nome = dados && (dados.Nome || dados.nome || (dados.Result && dados.Result.Nome));
  if(!nome){
    throw new Error('Provedor de consulta OAB não encontrou advogado(a) para essa OAB.');
  }
  return nome;
}

/* ------------------------------------------------------------------------
   4. FLUXO DE PREENCHIMENTO AUTOMÁTICO
------------------------------------------------------------------------ */
async function tentarPreencherAdvogadoPelaOab(){
  const status = $('statusConsultaOab');
  const campoNome = $('advogadoNome');
  const campoOab = $('advogadoOAB');
  if(!campoNome || !campoOab) return;

  // Nunca sobrescreve um nome já preenchido (manual ou de leitura de PDF).
  if(campoNome.value.trim()) return;

  const token = obterTokenApiOab();
  if(!token) return; // sem token configurado: segue manual, sem aviso/erro

  const { seccional, numero } = interpretarCampoOab(campoOab.value);
  if(!numero || !seccional){
    if(status) status.textContent = '';
    return;
  }

  if(status) status.textContent = 'Consultando OAB/' + seccional + ' ' + numero + '…';

  try{
    const nome = await chamarProvedorConsultaOab(numero, seccional, token);
    campoNome.value = nome;
    if(status) status.textContent = 'Preenchido a partir da consulta à OAB/' + seccional + ' ' + numero + '.';
  }catch(e){
    if(status) status.textContent = '';
    toast('Não foi possível preencher o(a) advogado(a) automaticamente (' + e.message + '). Preencha manualmente.', true);
  }
}

/* ------------------------------------------------------------------------
   5. LIGAÇÃO COM O FORMULÁRIO
------------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
  const campoToken = $('chaveApiOAB');
  const btnSalvar = $('btnSalvarChaveOAB');
  const btnLimpar = $('btnLimparChaveOAB');
  const status = $('statusChaveOAB');

  if(campoToken) campoToken.value = obterTokenApiOab();

  function atualizarStatusToken(){
    if(!status) return;
    status.textContent = obterTokenApiOab()
      ? 'Token salvo neste navegador.'
      : 'Nenhum token salvo — preenchimento automático desativado (uso manual continua funcionando).';
  }
  atualizarStatusToken();

  if(btnSalvar) btnSalvar.addEventListener('click', () => {
    if(salvarTokenApiOab(campoToken ? campoToken.value : '')){
      toast('Token salvo.');
      atualizarStatusToken();
    }
  });

  if(btnLimpar) btnLimpar.addEventListener('click', () => {
    if(campoToken) campoToken.value = '';
    salvarTokenApiOab('');
    toast('Token removido.');
    atualizarStatusToken();
  });

  const campoOab = $('advogadoOAB');
  if(campoOab) campoOab.addEventListener('blur', tentarPreencherAdvogadoPelaOab);
});
