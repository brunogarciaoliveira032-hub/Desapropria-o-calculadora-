# Testes de extração de PDF — Fase 1

Roda sem instalar nada (Node puro, sem dependências externas):

```bash
node tests/testes.js
```

## O que é testado

| # | Cenário | O que verifica |
|---|---------|-----------------|
| 1 | PDF digital | texto extraído direto (sem OCR); nº de processo correto |
| 2 | PDF escaneado (boa qualidade) | OCR de 1 tentativa só, confiança alta |
| 3 | PDF ruim / baixa qualidade | retentativa em resolução maior quando a 1ª tem confiança baixa; correção de erro de OCR (0↔O) |
| 4 | OCR imperfeito (página girada) | varredura das 4 rotações (0/90/180/270°) quando a rotação declarada no PDF não é a correta |
| 5 | PDF de mais de 300 páginas | processamento em lotes até o fim do arquivo, sem truncar, com peças espalhadas em posições distantes |

Cada cenário mede a **taxa de extração** (campos corretamente extraídos ÷
campos esperados no documento-teste, 18 campos) e falha o teste se ficar
abaixo da meta de **95%**. No final é impresso um resumo comparável entre
os 5 cenários.

## Como funciona (sem navegador nem Tesseract/pdf.js reais)

- `dom-stub.js` — `document`/`localStorage`/`performance` fake mínimos.
- `mocks-pdf-ocr.js` — `pdfjsLib` e `Tesseract` fake e controláveis por
  página (cada página do PDF-teste decide o que "o OCR lê" e com que
  confiança, por tentativa de resolução/rotação).
- `loader.js` — carrega os arquivos **reais** de `js/` (sem modificá-los)
  num contexto Node `vm` compartilhado, exatamente como tags `<script>`
  numa página.
- `fixtures.js` — documento-base realista (petição, laudo, sentença,
  depósito) e os 5 cenários acima.
- `testes.js` — a suíte propriamente dita.

## Testes de extração por IA — seção "IA" do checklist

```bash
node tests/testes-ia.js
```

Cobre os 5 itens da seção "IA" do checklist (valores, datas, índice,
modalidade, juros), exercitando `extrairCampos()` +
`aplicarInteligenciaJuridica()` sobre o mesmo documento-base desta suíte
(`fixtures.js`) mais cenários extras específicos em `fixtures-ia.js`
(modalidade direta/indireta/ambígua, índice ambíguo, índice em menção
solta, data no futuro, ordem cronológica improvável, sentença sem juros):

| Seção | O que verifica |
|---|---|
| Valores | oferta, pericial, sentença e depósito — extraídos corretamente e nunca confundidos entre si |
| Datas | oferta, imissão, sentença, depósito; + validação lógica (data futura e ordem cronológica improvável reduzem a confiança sem descartar o campo) |
| Índice | IPCA-E extraído com confiança alta quando ancorado em sentença/acórdão; fallback de confiança baixa para menção solta; alerta de ambiguidade quando mais de um índice aparece na sentença |
| Modalidade | `tipoAcaoDetectado` direta/indireta por marcadores de rito; placar equilibrado não "chuta" um lado — fica marcado como ambíguo |
| Juros | compensatórios e moratórios extraídos sem se confundir; ausência de menção não quebra o pipeline nem inventa valor |

20 testes, todos passando contra o código de `js/` tal como está no zip
(nenhum arquivo de produção foi alterado para os testes passarem).

## Bugs encontrados e corrigidos ao escrever estes testes

1. **`normalizarDatas` destruía o número do processo (padrão CNJ).**
   A regex de data numérica casava com pedaços do próprio nº de processo
   (ex.: em `...2020.8.26.0100`, o trecho `8.26.0100` virava `08/26/0100`),
   fazendo `numeroProcesso` falhar em praticamente qualquer PDF de
   processo real. Corrigido protegendo o padrão CNJ antes de normalizar
   datas.
2. **`REGEX_AREA` nunca casava com "m²"** (só com "m2"), porque `\b` não
   funciona depois de um caractere não-alfanumérico como "²". Como "m²" é
   a forma mais comum de escrever área em documentos jurídicos/
   imobiliários brasileiros, `areaImovel` ficava quase sempre vazio.
3. **Taxas de um único dígito real não eram corrigidas quando o OCR
   confundia os dois zeros decimais** (ex.: "6,00%" → "6,OO%", muito comum
   pois 6% a.a. é a taxa padrão de juros compensatórios no Decreto-Lei
   3.365/41). O filtro de segurança de "2 dígitos reais" de
   `corrigirErrosComunsOcr` bloqueava a correção nesse caso. Adicionada
   uma correção extra, ativada só quando o número está ancorado por "R$"
   (antes) ou "%" (depois) — contexto que já elimina o risco de mexer em
   texto não numérico mesmo com só 1 dígito real.
