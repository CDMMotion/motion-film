# Mótion Film — Handoff para a próxima conversa

Extensão CEP para After Effects 2026. Cole este arquivo no início da próxima
conversa pra retomar com o contexto essencial, sem precisar re-explicar tudo.

## Estrutura do projeto

- `motion-film/client/index.html` — markup do painel (roda no CEP/Chromium).
- `motion-film/client/panel.js` — toda a lógica do lado do painel (UI, polling,
  chamadas pro host).
- `motion-film/client/styles.css` — todo o CSS.
- `motion-film/host/host.jsx` — ExtendScript que roda dentro do After Effects
  de verdade; o painel chama funções daqui via `hostCall(nome, args, callback)`
  → `window.__adobe_cep__.evalScript(...)`.
- `motion-film/README.md` — changelog detalhado de tudo que foi feito e por
  quê. Vale ler antes de mexer em algo — o histórico de decisões (inclusive
  as que deram errado e foram revertidas) está lá.

**Agora dá pra testar contra o After Effects de verdade, ao vivo, do
próprio ambiente de dev** (isso mudou nesta sessão -- ignore qualquer
versão antiga deste arquivo que diga o contrário). O usuário tem o AE
instalado na própria máquina, e duas coisas ficaram configuradas de forma
permanente pra isso funcionar:

1. **Symlink**: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\
   motion-film` é um link simbólico apontando pra esta pasta (não uma
   cópia). Qualquer edição aqui aparece no AE só fechando/reabrindo o
   painel -- nunca mais é preciso copiar a pasta manualmente.
2. **Porta de debug remoto**: `motion-film/.debug` expõe a porta `8092`
   pro host `AEFT`. Com o painel Mótion Film aberto no AE, dá pra:
   - Ver os alvos inspecionáveis em `http://localhost:8092/json` (JSON) ou
     `http://localhost:8092` (lista HTML com link pro DevTools completo).
   - Rodar JS livre no contexto do painel via protocolo CDP bruto por
     WebSocket (`Runtime.evaluate`) -- inclusive chamando
     `window.__adobe_cep__.evalScript(jsx, callback)` a partir daí, o que
     dá acesso a rodar **ExtendScript de verdade dentro do AE aberto**,
     não só o lado `client/`.
   - `$.evalFile("C:/.../motion-film/host/host.jsx")` dentro de um desses
     `evalScript` recarrega o `host.jsx` editado na sessão do AE já
     aberta (o CEP só carrega esse arquivo uma vez, no início) -- evita
     reiniciar o After Effects a cada mudança de código durante um ciclo
     de teste.
   - PowerShell não tem cliente WebSocket pronto de mais alto nível; o
     jeito que funcionou foi `System.Net.WebSockets.ClientWebSocket` bruto
     (ver README, seção "Setup de desenvolvimento", pra detalhes/
     armadilhas de encoding do `Get-Content -Raw` que já morderam uma vez).
   - Teste em cima de uma **composição/camada de teste isolada, criada e
     destruída via script** (nome tipo `MF_TEST_SCRATCH`), nunca no
     projeto de verdade do usuário -- sempre limpar no final.

Ou seja: mudanças em `host.jsx` (ExtendScript) já não precisam mais ser só
"lidas com cuidado" -- dá pra validar de verdade (sem `expressionError`,
valores lidos de volta batendo com o esperado) antes de considerar a
mudança pronta. Mudanças em `client/` (HTML/CSS/JS puro) continuam
podendo ser testadas também num navegador comum isolado (servidor HTTP
local), útil pra iteração rápida de UI sem precisar do AE aberto -- mas
o teste final contra o AE de verdade agora é possível e vale a pena fazer
antes de reportar algo como pronto.

## Janelas satélite (padrão novo, v0.9.4)

A extensão agora pode ter **mais de uma janela** no mesmo bundle. Cada
janela extra é um `<Extension>` a mais em `CSXS/manifest.xml`, com
`MainPath` próprio e o **mesmo** `ScriptPath` (`./host/host.jsx`).
Primeira: `com.motionfilm.palette` -> `client/palette.html` +
`palette.js` + `palette.css` (Paleta de Cores). Detalhes no README,
seção "Changelog -- janela satélite Paleta de Cores".
Segunda: `com.motionfilm.layers` -> `client/layers.html` + `layers.js` +
`layers.css` ("MF - Camadas" -- os 3 botões de camada do rodapé
da Home, movidos pra cá por um toggle no popover Settings do principal;
estado via `host.jsx` `set/getAuxLayersEnabled` no `$.global`). Detalhes
no README, seção "Changelog -- janela satélite MF - Camadas".

- **`AutoVisible` da satélite TEM que ser `true`.** A ideia era
  `false` (abrir só sob demanda pelo menu), mas nesse build do CEP um
  painel `AutoVisible=false` **nunca ganha superfície de composição**:
  DOM monta, JS roda (confirmado pela ponte de debug e em navegador),
  mas nada pinta -- painel branco/cinza com a barra de abas do host
  vazando atrás (rastro). Nada disso resolveu: limpar `cep_cache`,
  casar geometria com a do principal, `--disable-gpu-compositing`,
  `<canvas>` keep-alive repintando por frame. `AutoVisible=true`
  resolveu na hora (o AE só compõe painel que ele criou no startup).
  Custo aceito: a satélite abre junto com o AE toda vez.
- **`palette.html` é um clone estrutural do `index.html`** (mesmo
  `.app-shell`/`.topbar`/`#status`/`<main>`/`.footer`/`#settings-popover`,
  mesma ordem de `<script>`), + um `<canvas id="paint-keepalive">`
  desenhado ao vivo (mantido por garantia; não foi o que resolveu).
  Quando precisar de outra satélite, clone o `index.html` de novo, não
  invente um shell novo.
- **`client/shared-core.js`** (`window.MF`): código compartilhado entre
  o principal e as satélites. Hoje só o color picker
  (`MF.initColorPicker(...)`) e `MF.color.*`. Carregado por `<script>`
  ANTES de `panel.js`/`palette.js` nos dois HTMLs.
- **`.debug`**: cada satélite precisa do próprio `<Extension>` com porta
  CDP distinta. Principal = `8092`, palette = `8093`, layers = `8094`.
- **`localStorage` NÃO é compartilhado** entre as janelas -- cada
  extension id tem o seu. Dados que as duas precisam ver: arquivo em
  disco (`window.cep.fs`), não `localStorage`.
- Bump de `ExtensionBundleVersion` + `Version` de cada `<Extension>` a
  cada release (todos juntos).
- **`--` (dois hífens) dentro de um comentário XML quebra o manifesto
  inteiro** e o CEP some com o bundle TODO do menu `Window > Extensions`
  (não só a extensão nova). Mordeu 3x aqui porque o estilo de comentário
  do projeto usa `--` como travessão. Em `manifest.xml`/`.debug`: nunca
  `--` em comentário; `flags` tipo `--enable-nodejs` só como conteúdo de
  `<Parameter>`. Validar com parser
  (`powershell -c "[xml](Get-Content -Raw manifest.xml)"`) antes de
  dizer que está pronto.

## Kit = biblioteca de Packs em disco (v0.9.7)

A aba Kit virou uma biblioteca de cenas pra copiar/colar entre projetos
(o usuário citou o Motion Bro, mas só a parte de galeria -- NÃO efeitos).
**REGRA: todo botão trabalha só com as camadas SELECIONADAS** -- "Save
Layers" cola soltas na agulha; "Save Comp" cola as mesmas camadas dentro
de UMA comp nova (tipo Pre-compose) na agulha; preview = só elas. Nunca
a comp inteira (uma versão que fazia isso travou o AE do usuário >10 min
na preview de uma comp 4K pesada). Parent/matte não selecionados entram
como dependência.
Tudo em `Documentos\Mótion Film Packs\` (fora da extensão: reinstalar
apaga a pasta da extensão): `library.json` + `packs/<id>/{meta.json,
data.json, preview.mp4/jpg, assets/}`. Salvar copia TODA mídia pro pack;
aplicar copia a mídia pra `<pasta do .aep>/Pack Assets/<pack>/` (projeto
nunca aponta pra biblioteca); apagar pack apaga a pasta. Export/import =
`.zip` escrito/lido em pedaços (aguenta GB). **JSON grande no host: `kitParseJson`, nunca `JSON.parse`** (polyfill em script, 6-9 s em 480 KB) **nem `eval`** (pack pode vir de zip alheio). Parent na aplicação = `setParentWithJump`. Preview em resolução
reduzida (`Resolution:[f,f]`, ~480px). Captura/aplicação por ARQUIVO
(`kitCaptureToFile`, `applyKitPackFile`, `renderKitPackPreview`) -- nunca
JSON grande pelo evalScript. Detalhes: README, "Kit vira biblioteca de
Packs em disco".

**Nunca recarregar (`location.reload`) um painel que usa Node assíncrono**
(Kit usa `fs.promises`, a janela Figma usa `http`): depois de reload o
event loop do Node morre pra página. Fechar e reabrir a janela. E sempre
manter OUTRA janela do bundle aberta antes de fechar o painel principal
pela ponte de debug -- sem nenhuma janela aberta não há como reabrir por
script (aconteceu: precisou do usuário).

## Padrão de atualização (pedido do usuário, v0.9.7 em diante)

Atualizar = rodar o `.exe` novo e clicar "Atualizar", sem exportar nada.
Isso só funciona porque **nenhum dado do usuário fica dentro da pasta da
extensão** (o instalador troca a pasta inteira). Tudo do usuário fica em
`Documentos\Mótion Film Packs\`:
- `packs/` + `library.json` -- os Packs;
- `settings.json` -- TODA chave `motionfilm-*` / `mfl-*` do localStorage
  de todas as janelas (tema, paletas, presets de legenda/estilo, tamanho
  do Null, layout). `shared-core.js` (`initUserDataStore`) despeja o
  arquivo no localStorage ao carregar e intercepta `Storage.prototype.
  setItem/removeItem` pra gravar junto. Motivo: o localStorage do CEP
  fica em `%TEMP%\cep_cache\AEFT_<versão do AE>_<id>` -- some quando o AE
  atualiza (já aconteceu 26.3 -> 26.5) ou numa limpeza de disco.

**Regra pra código novo:** qualquer coisa que o usuário cria/configura vai
em localStorage com prefixo `motionfilm-` (vira arquivo sozinho) ou em
arquivo dentro de `Documentos\Mótion Film Packs\`. Nunca em
`client/assets/` da extensão, nunca só em `app.settings` do AE (não passa
pra versão nova do AE -- o tamanho do Null tem cópia em localStorage por
isso).

**Pra gerar uma versão:** subir a versão no `CSXS\manifest.xml` (5
ocorrências) e o `?v=` dos `<script>` alterados, depois
`powershell -ExecutionPolicy Bypass -File installer\package.ps1` ->
`installer\dist\Motion-Figma-Layers-Setup-<v>.exe` +
`motion-film-v<v>-completo.rar` (exe + pastas manuais + `.reg` +
`INSTALAR.txt` gerado de `installer\INSTALAR.txt`). O instalador extrai
pra `<pasta>.new` e só depois troca (falha no meio não quebra a versão
instalada) e mostra "Instalada: X -> nova: Y".

## Mótion Figma Layers (v0.9.6) -- Figma -> After Effects

Ferramenta nova, no estilo dos 2 primeiros botões do Overlord: (1)
**Importar camadas** -- frame vira comp com cada camada separada, formas
como shape layers editáveis, textos editáveis; (2) **Rasterizar** -- cada
item selecionado vira um PNG. Três peças:

- **Plugin do Figma** (`figma-plugin/`: `manifest.json`, `code.js`,
  `ui.html`). Nome no Figma: "Mótion Figma Layers". Importado no
  **Figma Desktop** por Plugins > Development > Import plugin from
  manifest (não é publicado). `code.js` lê a seleção e monta o payload;
  `ui.html` (iframe) é quem fala com a rede.
- **Janela do AE** `com.motionfilm.figma` (`client/figma.html|js|css`,
  menu "Mótion Figma Layers", debug `8095`). Roda um servidor Node http
  em `127.0.0.1:47811` (+ `::1`): `GET /poll` (long-poll de 15s, é o
  "plugin está aberto" e o canal dos botões do AE), `POST /push` (payload
  + PNGs base64, enviado como `text/plain` pra não ter preflight CORS).
  No manifesto do plugin só pode `http://localhost:47811` -- o Figma
  recusa IP em `allowedDomains` ("must be a valid URL"), por isso o
  servidor escuta em 127.0.0.1 E ::1.
  Os botões do AE só enfileiram um comando; o plugin responde com push.
  PNGs vão pra `<pasta do .aep>/Mótion Figma Layers/<lote>/`, o MESMO
  nome da pasta do painel de projeto (`Mótion Figma Layers › <lote>`);
  `mflBatchName` dá nome único (" 2", " 3"...) pra reimportação nunca
  colidir no Collect Files. Projeto não salvo: `mflPickFolder` abre a
  escolha de pasta uma vez por sessão (até salvar o projeto); cancelar
  cancela a importação. Antes (até 0.13.0) iam pra `Figma Assets/<frame>_
  <data>` ou `Documentos/Mótion Figma Layers/Assets/`, com a pasta do
  painel reaproveitada e arquivos `_a1` repetidos -- causa das imagens
  offline em collects.
- **Construtor** `host/figma.jsx` (`mflBuild(jsonPath)`), carregado pela
  própria janela via `$.evalFile` (fora do host.jsx, recarrega a cada
  abertura da janela). Lê o JSON de um arquivo temporário.

Terceiro botão **Criar composição** (modo `comp`): `code.js` manda só
`{kind:"empty", name, w, h}` por item selecionado (tamanho arredondado em
px, nada exportado); `mflBuild` cria comps vazias na RAIZ do projeto
(comps de trabalho, não material importado -- sem pasta "Mótion Figma
Layers"), fps/duração da comp ativa (senão 30fps/10s), abre a última.

UI do plugin (pedido do usuário, estilo Overlord): janela 220x92 só com
ícones + rodapé (engrenagem com PNG 1x-4x e UMA linha de mensagem). Dica
de cada botão só aparece no rodapé após 1s de hover. Sem texto de
"conectado": desconectado = tudo cinza/sem clique; conectado = normal
(um `/ping` rápido acende na hora, o `/poll` segura 15s). Cores = tema do
AE: o servidor manda `theme {accent, panel}` em toda resposta (do
`lastTheme`/localStorage da janela, NUNCA evalScript por poll) e o plugin
aplica as mesmas contas de `MF.color.panelShades`.

**Nunca dar `location.reload()` na janela Mótion Figma Layers**:
confirmado ao vivo que depois de um reload o event loop do Node morre
pra página nova (nenhum servidor termina o `listen()`, nem em outra
porta) -- a ponte só volta FECHANDO e reabrindo a janela
(`__adobe_cep__.closeExtension()` pela 8095 e
`requestOpenExtension("com.motionfilm.figma","")` pela 8092 funciona).

Destino (pedido do usuário): com uma comp ativa no AE, TUDO entra nela --
frame vira comp nova e é adicionado como camada (centralizado, posição
padrão do AE), itens soltos e PNGs entram direto; o que chegou fica
selecionado e o usuário continua na comp em que estava. Sem comp ativa:
cria a comp e abre.

Regras de conversão (todas em `code.js`): coordenadas sempre por
`absoluteTransform` x inversa do container (cada camada já chega com
x/y/rot/scale prontos, âncora na origem local do nó); frame que recorta
-> precomp (+ máscara de cantos arredondados na camada); frame sem clip e
GROUP -> achatados, filhos direto na comp SEM Null (pedido do usuário;
opacidade do grupo multiplicada nos filhos); RECTANGLE/ELLIPSE -> rect/elipse
nativos (stroke interno/externo vira rect deslocado meio traço, continua
editável); demais vetores -> paths de `fillGeometry`; stroke que o AE
não reproduz (setas, por lado, interno/externo em path) -> contorno
`strokeGeometry` preenchido; texto -> box text com estilos por
caractere (`characterRange`, AE 24.3+), fonte resolvida por
`app.fonts.getFontsByFamilyNameAndStyleName`, e posição vertical
corrigida casando o topo dos glifos (`absoluteRenderBounds` do Figma x
`sourceRectAtTime` do AE); máscara do Figma -> track matte
(`setTrackMatte`) pros irmãos acima; DROP_SHADOW -> Drop Shadow
(opacidade 0-255!), LAYER_BLUR -> Gaussian Blur. **Gradientes e
imagens viram PNG**: as cores de Gradient Fill não são scriptáveis no AE
(`ADBE Vector Grad Colors` = `NO_VALUE`, confirmado ao vivo no 26.5).

Teste sem Figma: `code.js` roda num Figma simulado em Node (vm), o
payload vai pro `mflBuild` real pela ponte 8092 -- foi assim que tudo
acima foi validado, com render de frame comparado. Pegadinha que mordeu:
um ` ` dentro de regex no .jsx virou caractere literal ao salvar ->
"Syntax error" do ExtendScript e `$.evalFile` falhando em silêncio
(evalScript devolve string vazia). Usar `String.fromCharCode(0x2028)`.

**Instalador**: `installer/build.ps1` gera
`installer/dist/Motion-Figma-Layers-Setup-<versão>.exe` com o `csc.exe`
do .NET Framework (já vem no Windows) + `payload.zip` embutido. Instala a
extensão em `%APPDATA%\Adobe\CEP\extensions\motion-film` (por usuário,
sem admin), liga `PlayerDebugMode` em `CSXS.9..16`, copia o plugin pra
`Documentos\Mótion Figma Layers\Plugin Figma`. Num PC com o link de
desenvolvimento em Program Files ele NÃO duplica a extensão (só copia o
plugin). Mac: ainda não (o instalador é só Windows; a extensão e o
plugin em si já são multiplataforma, falta o empacotamento).

## Erros reais encontrados nesta sessão (e como evitar repeti-los)

Isso é o mais importante deste arquivo — cada um custou pelo menos uma
rodada de "não funcionou, tenta de novo" até a causa real aparecer.

1. **`Array.prototype.indexOf` não é confiável no ExtendScript.** O motor de
   script do After Effects (baseado em ES3) não garante esse método em
   arrays, mesmo sendo padrão em qualquer navegador moderno. Um
   `array.indexOf(x)` travou silenciosamente uma função inteira até virar
   erro visível. **Lição: em `host.jsx`, nunca usar `.indexOf()` em array —
   sempre um loop manual.** `String.prototype.indexOf` (em strings) é seguro,
   já é suportado desde sempre.

2. **`clip-path` do CSS não é confiável no Chromium do CEP.** Três tentativas
   de desenhar um recorte diagonal (duas com `clip-path: polygon()`, uma com
   `<path>` de SVG posicionado via `clip-path`-like absolute) renderizaram
   perfeitamente num navegador comum de teste, mas saíram erradas dentro do
   AE de verdade (formas separadas, cantos errados). O motor do CEP costuma
   ficar várias versões atrás de um navegador atual. **Lição: evitar
   `clip-path` para qualquer coisa visual nova; preferir `border-radius`
   simples, ou testar bem mais devagar/com mais confirmações do usuário
   antes de assumir que "funcionou no navegador" = "funciona no AE".**

3. **Definir `layer.inPoint` desloca `layer.outPoint` junto** (preserva a
   duração atual da camada em vez de só cortar no lugar). Isso causava um
   "sobra" no fim de um Null criado por script, do tamanho exato do
   `inPoint` aplicado. **Lição: ao setar `inPoint` e `outPoint` de uma
   camada nova via script, sempre setar `inPoint` primeiro e `outPoint` por
   último** — assim o valor final de `outPoint` não é afetado pelo
   deslocamento que `inPoint` causa.

4. **Nome de camada de texto muda a cada tecla digitada.** Um sinal
   "a camada selecionada mudou?" que combinava índice + nome da camada
   (`layer.index + "|" + layer.name`) fazia o polling de fundo (a cada
   700ms) achar que a camada mudava a cada tecla, disparando releitura de
   `sourceText.value` — o que faz o AE cancelar a edição de texto ativa no
   viewport, resetando o cursor pro início. **Lição: para detectar "mudança
   de seleção", usar só o índice da camada, nunca o nome** (nomes de texto
   sem nome próprio espelham o conteúdo).

5. **Zerar uma referência a callback antes de checar se deve chamá-la.**
   `closeFontPicker()` zerava `fontPicker.onPick`, e o código de clique
   fazia `closeFontPicker(); if (picker.onPick) picker.onPick(...)` —  como
   `fontPicker` e `picker` eram o mesmo objeto, a checagem já lia `null`.
   A fonte nunca trocava, e eu passei duas rodadas inteiras mexendo no lugar
   errado (`host.jsx`) até reler o `panel.js` com mais calma e achar isso.
   **Lição: sempre guardar uma referência de callback numa variável local
   ANTES de rodar qualquer coisa que possa zerar o objeto original.**

6. **Cache de "resultado vazio" ainda é `truthy` em JS.** `if (cache)` trata
   um array vazio `[]` como "já carregado", nunca tentando de novo. Isso não
   era a causa raiz de um bug de fontes (a causa real foi o item 1), mas é
   uma armadilha genérica válida: **só cachear resultados que realmente têm
   conteúdo.**

7. **`[hidden] { display: none !important }` (regra global já existente no
   projeto) sempre vence uma classe CSS tipo `.algo.is-active { display:
   flex }`.** Ao construir as abas de página (Home/Text), a visibilidade
   precisou ser controlada só pelo atributo `hidden` (igual
   `els.textSection.hidden = true/false` já fazia em outros lugares), nunca
   por uma classe CSS concorrente.

8. **AE limpa a seleção de keyframes da composição inteira assim que os
   keyframes de UMA propriedade são tocados.** Qualquer utilitário que
   precisa ler a seleção de keyframes de VÁRIAS propriedades/camadas
   precisa capturar tudo primeiro (fase 1: só leitura), e só depois
   modificar (fase 2). Isso já estava documentado no README antes desta
   sessão, mas vale repetir -- é usado em `reverseSelectedKeyframes`,
   `repositionSelectedKeyframes`, `copySelectedKeyframeCurves`/
   `pasteSelectedKeyframeCurves`, todos em `host.jsx`.

9. **Uma alteração de CSS/margem que "não faz efeito nenhuma" pode ter
   uma causa completamente diferente do que parece.** Um pedido pra
   diminuir o espaço entre seções fechadas de um "folder" virou várias
   rodadas trocando `margin-bottom` de 10px até 0px sem nenhuma mudança
   visível no AE -- a causa real não era margem nenhuma: o `.section-body`
   colapsado (`max-height: 0`, `opacity: 0`) ainda media **31px reais de
   altura**, porque `max-height: 0` nunca reduz o `padding` de um
   elemento (isso é comportamento padrão do CSS em qualquer navegador,
   não um bug do CEP) -- só descoberto medindo `getBoundingClientRect()`
   de verdade via a ponte de debug, não só lendo propriedades de estilo.
   **Lição: quando um ajuste de CSS parece não ter efeito nenhum mesmo
   depois de eliminar cache como causa, meça a altura/posição REAL
   renderizada (`getBoundingClientRect`), não só as propriedades CSS
   computadas -- padding/border não encolhem por causa de `max-height`.**

10. **Antes de suspeitar de um bug de verdade num script de PowerShell
    que fala com uma ponte externa (CDP/WebSocket), suspeite de
    `Get-Content -Raw` primeiro.** `Get-Content -Raw` devolve um objeto
    com metadados extras do provider (`PSPath`, `PSDrive` etc.) grudados
    no texto; passar isso direto pro `ConvertTo-Json` serializa um objeto
    gigante em vez de uma string simples, quebrando silenciosamente
    qualquer coisa que espere receber só o conteúdo do arquivo. Um script
    de teste inteiro pareceu estar travando o ExtendScript do AE (numa
    investigação de várias rodadas) até essa causa aparecer -- o bug
    nunca esteve no lado do After Effects. **Lição: sempre forçar
    `[string]$conteudo = Get-Content -Raw ...` (cast explícito) antes de
    serializar/usar o resultado.**

11. **`Property.setPropertyParameters()` num Dropdown Menu Control
    (`ADBE Dropdown Control`) recém-criado lança `ReferenceError: Object
    is invalid`** no AE 2026 (26.3x87), testado ao vivo de várias formas
    (array literal, `new Array(...)`, imediatamente após a criação ou
    não, layer limpa) -- sempre o mesmo erro. **Lição: pra um controle
    tipo "modo/opção numerada" em `host.jsx`, usar um Slider Control
    comum com valores inteiros (documentando o mapeamento número→nome
    num comentário) em vez de Dropdown Menu Control, já que essa API
    específica está quebrada nesta versão do AE.**

12. **Um `<section>`/painel com `box-shadow` sempre ativo (mesmo quando
    "fechado"/sem conteúdo visível) pode ler como uma linha ou faixa
    escura residual contra o fundo da página.** Corrigido desabilitando
    o `box-shadow` especificamente no estado colapsado
    (`.section.is-collapsed { box-shadow: none }`), mantendo normal
    quando expandido.

13. **Pra gerar animação por caractere com ordens diferentes (do centro,
    aleatório, a partir de um índice, etc.), um Range Selector
    (`ADBE Text Selector`) não é suficiente** -- ele só desliza uma
    janela de seleção respeitando a ordem natural dos caracteres.
    Precisa de um `ADBE Text Expressible Selector`, cuja expressão roda
    uma vez por caractere com `textIndex`/`textTotal` disponíveis,
    permitindo calcular uma ordem arbitrária. Detalhes completos da
    mecânica no README, seção "Character Reveal: modos de direção +
    canais extras".

14. **`effect("nome")` numa expressão do AE casa pelo nome ATUAL do
    efeito, não pelo nome de quando a expressão foi escrita** -- renomear
    um efeito via script (`prop.name = "..."`) depois de uma expressão já
    referenciar `effect("NomeAntigo")` quebra a expressão na hora
    (`effect named 'X' is missing`). Isso mordeu de verdade ao renomear o
    slider "Direction" pra incluir a opção escolhida
    (`applyDirectionLabel`). **Lição: se um efeito vai ter o nome mudado
    dinamicamente por script, nenhuma expressão pode referenciá-lo por
    nome fixo** -- usar índice numérico (`effect(i)`, iterando com
    `try/catch` até achar o `.name` certo) em vez de `effect("nome")`.

15. **Dentro da expressão de `Amount` de um `ADBE Text Expressible
    Selector`, `thisLayer` não tem `.property()` nem `.Effects`** -- só
    funciona pra coisas simples tipo `thisLayer.inPoint`. Chamar
    `thisLayer.property("ADBE Effect Parade")` lá dentro lança
    `TypeError: thisLayer.property is not a function`, mesmo sendo um
    padrão perfeitamente válido em QUALQUER outra expressão normal do AE.
    `effect(nomeOuÍndice)` (a função global, não um método de
    `thisLayer`) continua funcionando normalmente nesse contexto restrito
    -- foi assim que a lição 14 acima acabou sendo resolvida (índice
    numérico via `effect(i)`, nunca `.property()`). Achado ao vivo, não
    documentado em lugar nenhum -- vale testar de verdade (via a ponte de
    debug) qualquer expressão nova dentro de um Selector antes de
    considerar pronta, mesmo que pareça um padrão básico de expressão.

16. **Não existe "seção dobrável" nativa e scriptável no Effect Parade do
    AE.** `effects.addProperty("ADBE Group")` e mais 5 variações de nome
    (`ADBE Effect Group`, `ADBE Layer Effects`, `ADBE Group Control`,
    `ADBE Group Layer`, `"Group"`) todas falham com `Can not add a
    property with name "X" to this PropertyGroup`. As seções tipo pasta
    ("Transform"/"Style") que scripts de terceiros compilados (TextEvo2)
    mostram no Effect Controls são desenhadas pelo próprio plugin
    compilado (SDK de efeitos C++), igual o dropdown da lição 11 -- não
    uma funcionalidade do AE disponível via ExtendScript. **Lição: pra
    organizar parâmetros em grupos visuais, a única opção real de uma
    extensão CEP é fazer isso no lado do painel (`client/`), não no
    Effect Controls do AE.**

17. **`:` (dois-pontos) num nome de arquivo Windows não dá erro na hora
    de escrever -- só falha silenciosamente depois.** Nomes de ícone da
    API Iconify vêm como `"prefix:nome"` (ex.: `"material-symbols:star"`).
    Usar esse nome direto (só filtrando por uma lista de caracteres
    permitidos que incluía `:` por engano) num `File("...nome.svg")` +
    `file.write()` do ExtendScript NÃO lançou exceção nenhuma, e
    `app.project.importFile()` "importou com sucesso" (a camada e o
    `sourceFile` apareciam certinhos, com o `:` no caminho) -- mas
    `folder.getFiles("*.svg")` na mesma pasta voltava lista vazia. `:` é
    reservado no Windows/NTFS (letra de unidade / Alternate Data Stream),
    então o `write()` quase certamente foi parar num stream oculto anexado
    a outro arquivo, não num `.svg` de verdade. **Lição: qualquer nome que
    vem de uma fonte externa (API, nome de camada, input de usuário) e vai
    virar nome de arquivo tem que trocar `:` (e `\ / * ? " < > |`) por um
    caractere seguro ANTES de tocar no disco -- e confirmar com
    `folder.getFiles(...)` de verdade depois, não só confiar no retorno
    "sem erro" do `File`/`importFile`.**

18. **`window.require`/`require` bruto não são confiáveis neste CEP --
    use `window.cep_node.require`.** Um teste isolado achou
    `window.require` funcionando uma vez (`typeof` retornou `"function"`),
    mas depois de recarregar o painel algumas vezes ele sumiu (`typeof
    window.require` virou `"undefined"`, e `require` puro nem existe como
    identificador global -- referenciar direto lança `ReferenceError`,
    diferente de checar com `typeof`). O bridge que funcionou de forma
    consistente em todos os testes repetidos foi `window.cep_node.require`
    -- um objeto com `require`/`process`/`Buffer`/`global` já expostos.
    **Lição: nunca confiar num `window.require` que "funcionou uma vez"
    sem reconfirmar depois de qualquer reload -- prefira `cep_node`.**

19. **`child_process.execFile` pode travar pra sempre neste ambiente,
    mesmo quando o processo já terminou.** Confirmado ao vivo com
    `ffmpeg.exe` e `whisper-cli.exe`: o evento `exit` dispara corretamente
    (~50ms depois do processo realmente sair, com `code: 0`), mas o
    evento `close` **nunca dispara** -- os pipes de stdio nunca sinalizam
    EOF, mesmo com o processo havia muito encerrado. `execFile`/`exec` só
    chamam o callback no `close`, então ficam esperando indefinidamente
    (um timeout artificial "resolve" isso só porque força o cleanup, não
    porque o processo realmente precisava ser morto -- e mesmo assim sem
    reportar erro nenhum, o que mascara o problema). **Lição: nesse
    ambiente específico, usar `child_process.spawn()` e ouvir o evento
    `exit` (não `close`) pra saber quando um processo filho terminou --
    ler stdout/stderr manualmente via `child.stdout.on("data", ...)` com
    `setEncoding("utf8")`.**

20. **Executáveis compilados originalmente pra Linux/Mac podem corromper
    caminho com acento no Windows.** `whisper-cli.exe` (whisper.cpp,
    cross-compilado) lê seus próprios argumentos de linha de comando
    assumindo UTF-8, mas o Windows entrega `argv` pra um app de console
    na codepage ANSI por padrão -- um caminho tipo `C:\Users\Usuário
    André\...` saía corrompido (`Usu\ufffdrio`) e o programa falhava.
    `ffmpeg.exe` (mesma classe de programa, mas com tratamento próprio de
    Unicode no Windows) não tem esse problema -- testado ao vivo lado a
    lado, mesmo caminho acentuado. **Lição: quando um executável de
    terceiros se comporta mal com acento no Windows, o nome curto (8.3)
    do Windows (`cmd.exe /c "for %I in (...) do @echo %~sI"`) é um
    contorno confiável, sem precisar mudar o nome de usuário nem a
    localização de nada.**

21. **`window.prompt()`/`alert()`/`confirm()` nativos do navegador não
    são seguros de usar neste CEP.** Testado ao vivo: chamar
    `window.prompt()` travou a thread de JavaScript do painel inteiro --
    nem uma expressão trivial (`1+1`) respondia mais depois, e não havia
    diálogo nenhum detectável nem fechável via CDP
    (`Page.handleJavaScriptDialog` retornou "No dialog is showing",
    sugerindo que o diálogo nativo do Windows nunca apareceu de forma
    visível/rastreável, só bloqueou a execução). **Lição: nunca usar
    diálogos nativos do navegador nesta extensão -- qualquer input do
    usuário (nome de preset, confirmação, etc.) tem que ser um elemento
    normal dentro do próprio painel** (campo de texto num popover, como
    o rodapé "salvar preset" do seletor de Caption Preset). Recuperar de
    um travamento desses exige fechar e reabrir o painel de dentro do
    After Effects -- reload remoto via CDP (`Page.reload`) não resolveu.

22. **`PropertyType.INDEXED_GROUP`/`NAMED_GROUP` não bastam pra saber
    quando `addProperty()` é obrigatório.** O grupo `ADBE Text Animator
    Properties` (e `ADBE Text Selectors`) reporta `propertyType ===
    PropertyType.NAMED_GROUP` -- confirmado ao vivo -- então a lógica
    genérica de captura/aplicação de Style Preset (`captureStyleNode` /
    `applyStyleChildren` em `host.jsx`), que decide entre
    `addProperty(matchName)` (indexado) e `.property(matchName)` (grupo
    nomeado normal, tipo Transform) olhando só esse enum, tomava o
    caminho errado: `.property("ADBE Text Anchor Point 3D")` num
    animator recém-criado (sem essa propriedade habilitada ainda) não dá
    erro nenhum e devolve um objeto de propriedade que parece válido --
    mas com `canSetExpression === false`. Resultado: `prop.expression =
    node.expression` falha silenciosamente (capturado pelo try/catch), a
    propriedade fica sem expressão nenhuma, e só os canais com
    keyframe/valor estático (que não passam por `canSetExpression`)
    chegam corretos. Sintoma reportado pelo usuário: "as keyframes estão
    lá, mas a animação do texto não acontece" -- porque é exatamente a
    expressão (não os keyframes) que faz efeitos tipo TextEvo2 realmente
    se mover. **Lição: pra esses dois grupos especificamente, sempre
    forçar `addProperty(matchName)` (com fallback pra `.property()` se
    já existir), independente do que a captura registrou em
    `isIndexedChild` -- eles são a exceção onde a API do AE não segue a
    própria classificação de tipo que ela mesma expõe.** Ver
    `STYLE_PRESET_FORCE_ADD_MATCHNAMES` em `host.jsx`.

23. **`window.cep.fs` (diálogo nativo de Salvar/Abrir arquivo + leitura/
    escrita) existe e funciona neste CEP, mesmo sem carregar
    `CSInterface.js`.** Confirmado ao vivo:
    `window.cep.fs.showSaveDialogEx`/`showOpenDialogEx`/`writeFile`/
    `readFile` estão todos presentes em `window.cep.fs` -- é uma API
    nativa exposta direto pelo host do CEP, independente da lib
    `CSInterface.js` (que este projeto nem carrega). Assinatura real
    (achada numa cópia de `CSInterface.js` de OUTRA extensão instalada
    na mesma máquina, já que a documentação embutida no objeto nativo é
    só `[native code]`): `showSaveDialogEx(title, initialPath,
    fileTypes, defaultName)` devolve `{ err, data: "caminho" }`;
    `writeFile(path, contents)` devolve `{ err: 0 }` no sucesso. Achei
    até um exemplo de uso já validado nesta mesma pasta de extensões
    (`com.flexguipro.ext`, outra extensão claramente feita por IA) com
    um comentário direto sobre o motivo de preferir isso a um
    `<a download>`: **"Blob downloads are ignored by some CEP Chromium
    builds"** -- por isso `saveTextFileWithNativeDialog()` em
    `panel.js` tenta `cep.fs` primeiro e só cai pro Blob/`<a download>`
    como último recurso. Pra importar (abrir arquivo), um
    `<input type="file" multiple>` normal + `FileReader` funciona sem
    problema nenhum e é mais simples que `cep.fs.showOpenDialogEx` --
    não precisa lidar com o encoding base64/utf8 do `readFile`.

24. **Um listener de `click` no `document` que fecha popovers "ao
    clicar fora" fecha TAMBÉM o clique que acabou de abrir o popover,
    se o botão-gatilho não chamar `event.stopPropagation()`.** O botão
    de idioma/preset/style-preset da aba Captions não tinha essa
    chamada -- o clique no botão executa `openOptionPicker()` (mostra o
    popover), e o MESMO evento, ao borbulhar até o `document`, dispara
    o listener global que fecha todo popover aberto (`closeOptionPicker
    ()`), escondendo de volta o popover que acabou de aparecer -- tudo
    dentro do mesmo clique síncrono, sem erro nenhum no console.
    Sintoma pro usuário: clicar no botão parecia não fazer nada. O
    Color Picker já tinha a proteção certa (`event.stopPropagation()`
    logo no início do handler do swatch, ver `createColorSwatch`) --
    faltava replicar o mesmo em `captions-preset-button`/
    `captions-language-button`/`captions-style-preset-button`. **Lição:
    todo botão que abre um popover/picker cujo fechamento depende de um
    listener global de "clicar fora" precisa chamar
    `event.stopPropagation()` no PRÓPRIO clique de abertura -- não só o
    popover em si precisa disso (esse já tinha, `buildOptionPicker`
    sempre parou propagação nos cliques internos).**

25. **CSS `max-width`/`grid-template-columns` animados ficam visivelmente
    instáveis no Chromium deste CEP -- e `grid-template-columns` com
    unidade `fr` nem chega a interpolar.** Confirmado ao vivo com
    `getComputedStyle` amostrado a cada ~30ms: um `transition:
    grid-template-columns .3s` de `0fr` pra `1fr` já mostrava o valor
    final no PRIMEIRO frame amostrado -- sem nenhum passo intermediário,
    ou seja, esse motor específico simplesmente não sabe interpolar
    `fr` nessa propriedade (mesmo sendo uma técnica CSS bem
    estabelecida em navegadores modernos). `max-width` tecnicamente
    anima, mas por ser uma propriedade que afeta layout (o navegador
    recalcula tudo a cada frame), ficou visivelmente instável/com
    "engasgo" rodando dentro do host pesado do AE. **Lição: pra
    animações de largura/revelar-texto que precisam ficar suaves nesse
    ambiente, não confiar em transições CSS de propriedades de layout
    -- usar a técnica FLIP (medir posição antes, aplicar a mudança
    instantânea, compensar com `transform: translateX()`, depois
    animar esse transform até zero). `transform`/`opacity` são as
    únicas propriedades garantidas como suaves aqui, por rodarem no
    compositor sem recálculo de layout por frame.** Ver
    `animateTabLayoutChange` em `panel.js`.

26. **O ffmpeg já baixado (aba Captions) não tem `libx264` -- `.mp4`
    gerado com ele não toca no Chromium do painel.** Confirmado ao
    vivo (`ffmpeg -encoders`): esse build tem `--disable-libx264` e
    `--disable-libx265`, só `libopenh264` pra H.264 (sem licença AVC
    "de verdade" embutida) e nem sempre resulta num arquivo que o
    `<video>` do Chromium aceita. `libvpx`/`libvpx-vp9` (WebM) estão
    disponíveis e funcionam sem drama nenhum. **Lição: qualquer preview
    em vídeo dentro do painel usa `.webm`/VP9, não `.mp4`, se for
    gerado com esse ffmpeg específico** -- ver
    `client/assets/kit-previews/README.md`.

27. **`Page.captureScreenshot` (CDP) não captura o frame de um
    `<video>` tocando -- vem preto/em branco, mesmo com o vídeo de
    verdade rodando.** Confirmado ao vivo: `video.paused` era `false`
    e `video.currentTime` avançava normalmente, mas o screenshot da
    área continuava mostrando só o fundo escuro do painel, sem nenhum
    traço do vídeo. Isso é uma limitação conhecida de captura de
    screenshot via CDP com vídeo (a decodificação às vezes usa um
    caminho de composição/GPU que a screenshot API não compõe
    corretamente) -- não é bug no código sendo testado. **Lição: pra
    confirmar que um `<video>` está renderizando de verdade (não só
    "tocando" no sentido de `paused=false`), desenhar o frame atual num
    `<canvas>` (`ctx.drawImage(video,0,0)`) e ler um pixel com
    `getImageData` -- isso reflete o conteúdo real decodificado,
    contornando a limitação do screenshot.** Foi assim que a prévia em
    hover do Kit foi confirmada de verdade (pixel central bateu com a
    cor codificada no vídeo de teste).

28. **Um "conserta X forçando uma releitura" pode reintroduzir um bug
    antigo se aplicado largo demais.** O fix dos botões de parágrafo
    (item anterior) forçava `refreshText(true)` -- que chama
    `sourceText.value` -- depois de QUALQUER `commitTextField`, não só
    dos botões que realmente precisavam. Isso incluía os campos
    numéricos (fontSize, tracking, etc.), que passam pelo MESMO commit
    em toda edição normal (não só em casos raros) -- e ler
    `sourceText.value` é exatamente o que reseta o cursor de edição de
    texto do usuário quando ele está digitando direto no viewport do
    AE (ver o comentário de `lastLayerKeyForText`, mais acima). Usuário
    confirmou ao vivo: digitar no AE, pausar e voltar às vezes pulava
    o cursor pro início -- efeito colateral direto do fix anterior
    ficar bom demais em disparar de novo. **Lição: ao forçar uma
    releitura pra corrigir um controle "preso" (stuck UI), escopar
    isso só aos controles que de fato não têm outra forma de refletir
    o estado novo (toggle sem atualização otimista própria) -- nunca
    aplicar largo a uma função compartilhada só porque é o caminho mais
    fácil, principalmente quando essa releitura tem um custo conhecido
    (aqui, resetar um cursor de edição ativo).** Ver o parâmetro
    `forceRefresh` de `commitTextField` em `panel.js`.

29. **`layer.name`, sozinho, parece carregar o mesmo efeito colateral
    de `sourceText.value` numa camada de texto sem nome próprio.**
    Depois do item 28 (que só resolveu parte do bug), usuário confirmou
    que o cursor ainda pulava -- causa real dessa vez:
    `readLayerTransform()` devolvia `layer.name` na resposta, chamada
    em TODO tick de 700ms sem gate nenhum (ao contrário de
    `readTextLayer`, que É protegido por `lastLayerKeyForText`). Numa
    camada de texto sem nome próprio, o AE usa o próprio Source Text
    como nome de exibição -- e só o ATO de ler `.name` nesse caso
    parece interromper o cursor de edição ativo, do mesmo jeito que ler
    `sourceText.value` direto interrompe (documentado no item sobre
    `lastLayerKeyForText`, mais acima). **Lição: em qualquer leitura
    chamada sem gate a cada tick do polling (Transform/Shape,
    consideradas "seguras"), nunca incluir `layer.name` -- mesmo que
    pareça inofensivo, ele reflete Source Text ao vivo pra camadas de
    texto sem nome, e carrega o mesmo risco de interromper um cursor de
    edição ativo no viewport do AE.** Conferido também que esse campo
    nunca teve uso nenhum no lado do painel -- removido sem perda.

30. **`Page.reload`/`Page.navigate` via CDP no painel deste CEP não mata
    o `setInterval` da sessão anterior -- fica um "zumbi" rodando em
    paralelo com o script novo, para sempre.** Descoberto ao vivo
    depurando por que uma correção de throttle no polling não parecia
    surtir efeito: o stack trace das chamadas de `readLayerTransform`
    mostrava DUAS origens diferentes ao mesmo tempo -- uma apontando pra
    um número de linha de uma versão ANTIGA do arquivo (chamada por
    `Timeout._onTimeout`, ou seja, um `setInterval` de uma carga
    anterior do painel, ainda vivo) e outra pro número de linha certo
    da versão atual. Isso quer dizer que, numa sessão de debug longa com
    muitos reloads via CDP (como esta), CADA reload pode deixar pra trás
    mais um `setInterval` zumbi de 700ms rodando com o código
    congelado de quando foi criado -- explicando por que um teste podia
    "confirmar" um comportamento que na verdade vinha de uma mistura de
    código antigo e novo coexistindo. **Lição: depois de qualquer
    mudança que precise ser testada com precisão sobre TIMING/
    FREQUÊNCIA de algo (não só "o elemento novo apareceu"), a forma
    confiável de garantir um estado limpo é fechar e reabrir o painel
    de dentro do próprio After Effects (Window > Extensions > Mótion
    Film, desligar e ligar de novo) -- não confiar em `Page.reload`/
    `Page.navigate` via CDP pra isso.** Isso também é um candidato real
    pra explicar bugs de usuário que "pioram com o tempo de uso" -- se
    o painel do AE tiver algum gatilho de ciclo de vida parecido
    (redockar, trocar de workspace, etc.) que recarregue o HTML sem
    matar o JS anterior corretamente, zumbis assim poderiam se acumular
    numa sessão real de dias de uso também.

30b. **Achado adicional, bem mais tarde na mesma sessão longa**:
    `Page.navigate` via CDP com cache-busting só no documento principal
    (`index.html?cb=timestamp`) não garante que um `<script
    src="panel.js">` sem query string próprio venha atualizado -- o
    navegador pode servir uma cópia em cache desse arquivo mesmo o HTML
    em volta sendo buscado de novo de verdade. Descoberto instrumentando
    `window.__adobe_cep__.evalScript` pra contar chamadas de
    `readShapeLayer` depois de uma correção que deveria ter reduzido
    bastante essa contagem -- continuou no ritmo de antes; um
    `fetch("panel.js")` manual DENTRO da própria página confirmou que o
    arquivo em disco já tinha a correção, só a versão que já estava
    CARREGADA (pela tag `<script>`, no momento daquela navegação
    específica) é que continuava com a antiga. Some com o item 30
    (zumbis de `setInterval` de cargas anteriores ainda rodando) e o
    resultado de qualquer teste de contagem/timing feito por cima de
    muitos reloads acumulados vira ruído -- não dá pra confiar nele.
    **Corrigido pro MEU fluxo de teste** (não é mudança na extensão):
    enviar `Network.setCacheDisabled(true)` (CDP) na mesma conexão
    WebSocket, antes do `Page.navigate`. Ainda assim, o jeito
    realmente confiável pra qualquer teste de timing continua sendo o
    do item 30: fechar/reabrir o painel de dentro do próprio AE.

31. **"Fill Color" do Text Animator "TextEvo" aparecer vermelho no
    Effect Controls não é bug -- é o flash inicial do efeito de
    revelação, não a cor final renderizada.** Usuário reportou preset
    de Style copiado mostrando fill vermelho mesmo com o texto branco
    na camada de origem. Investigação (sem alterar nada, só
    diagnóstico): o Text Animator "TextEvo" tem `ADBE Text Fill Color`
    como valor ESTÁTICO (não dirigido por expressão, ao contrário de
    quase toda outra propriedade do animator, que referencia o Pseudo
    Effect ao vivo) -- esse vermelho só aparece de fato renderizado
    proporcionalmente ao "Amount" de um Range Selector
    (`ADBE Text Expressible Amount`), que por sua vez é dirigido por
    expressão referenciando o slider "Strength" do Pseudo Effect
    (decai de 100 a 0 logo no início da revelação de cada caractere).
    Confirmado ao vivo: capturado e aplicado IDENTICAMENTE entre a
    camada original e a cópia via Style Preset (mesma expressão, mesmo
    valor estático, `canSetExpression: true`, sem erro nenhum) -- e o
    usuário confirmou visualmente que o resultado aplicado se comporta
    igual ao original (começa vermelho no primeiro frame, clareia até
    branco). **Lição: um valor estático "esquisito" (tipo vermelho)
    visível no Effect Controls de um efeito de terceiros pode ser
    completamente normal se ele for só um dos vários ingredientes que
    alimentam uma mistura ao vivo controlada por outra propriedade --
    não assumir bug sem entender a cadeia completa até a cor final.**
    Lição de método também: `Property.valueAtTime()`/`.value` lido via
    script NÃO reflete o comportamento real de uma expressão de Text
    Animator que depende de `textIndex`/`textTotal` (variáveis só
    vinculadas durante a renderização real por caractere) -- confirmei
    isso lendo o MESMO valor "travado" tanto na camada original quanto
    na cópia, o que por si só já indicava limitação do método de teste,
    não do código.

32. **Correção do item 22/23 (forçar `addProperty()` em "ADBE Text
    Animator Properties"/"ADBE Text Selectors") tinha um efeito
    colateral real: "ativa" canais que nunca foram genuinamente
    adicionados na camada de origem.** Usuário reportou (com prints da
    busca "fill" na Timeline) que um preset com TextEvo aplicado vinha
    com fill vermelho sólido, enquanto a camada de origem (criada à
    mão, nunca tocada pela nossa extensão) não mostra NENHUMA
    propriedade de fill na mesma busca -- prova de que o canal nunca
    esteve realmente ativo lá. Causa raiz: `ADBE Text Animator
    Properties` sempre reporta `numProperties: 103` mesmo num animator
    TOTALMENTE vazio recém-criado (confirmado ao vivo) -- não é "quantos
    canais foram realmente adicionados", é um número fixo estrutural.
    `captureStyleNode` varre esse `numProperties` sem filtro nenhum,
    então captura um valor pra QUALQUER um dos 103 slots, incluindo os
    que nunca foram habilitados de verdade (o TextEvo, pra esse estilo
    de revelação específico, nunca ativa o canal "Fill Color" -- ele só
    "existe" porque o slot sempre está acessível via matchName). Antes
    da correção do item 22, aplicar um desses slots inertes usava
    `.property(matchName)`, que devolve algo inofensivo/sem efeito de
    renderização; depois da correção, TODOS os filhos passaram a usar
    `addProperty()` forçado -- que genuinamente ATIVA/renderiza o
    canal, mesmo pra um slot que nunca deveria estar ativo. **Correção
    refinada**: só força `addProperty()` num filho de
    `STYLE_PRESET_FORCE_ADD_MATCHNAMES` se ele tiver expressão ou
    keyframes capturados (`nodeNeedsForcedAdd` em `host.jsx`) -- exatamente
    o conjunto que precisava da correção original (toda propriedade
    genuinamente dirigida pelo TextEvo é por expressão). Um valor
    puramente estático volta a usar `.property(matchName)`, igual ao
    comportamento de antes da correção do item 22. **Testado ao vivo**:
    depois da correção, `ADBE Text Position 3D` (dirigida por
    expressão) continua com `canSetExpression: true` e a expressão
    aplicada certinha -- sem regressão; `ADBE Text Fill Color` (estático)
    agora volta pra `canSetExpression: false`, o mesmo estado "inerte"
    identificado desde a investigação original desse bug. **Limitação
    conhecida**: um valor estático genuinamente adicionado à mão pelo
    usuário nesses dois grupos específicos não seria transferido
    corretamente por esse caminho -- caso raro, não coberto. **Nota
    importante pro usuário**: presets já capturados/camadas já coladas
    ANTES dessa correção continuam com o bug (o Fill Color já foi
    forçosamente adicionado nelas) -- precisam ser recriadas (deletar a
    legenda e gerar de novo, ou remover manualmente o parâmetro Fill
    Color no Effect Controls) pra se beneficiar da correção.
33. **A aba "Text" (Text Reveal, reveal por caractere) foi removida por
    pedido explícito do usuário** -- ele está reformulando essa feature do
    zero em outra conversa e quis evitar conflito entre as duas versões.
    Removido de `index.html` (bloco `#page-text` inteiro apagado, e o
    botão da aba `#page-tab-text` também -- a aba sumiu de vez da barra de
    navegação, não ficou nem como placeholder/casca vazia -- a navegação
    de abas em `panel.js`/`initPageTabs` é genérica, lê `data-page` de
    quem quer que exista no DOM, então não precisou de nenhum ajuste extra
    pra parar de listar essa aba), `panel.js` (bloco inteiro Add/Copy/
    Paste/Remove + Direction picker + `lastLayerKeyForReveal` + as 3
    chamadas de conexão no `init()`/polling), `host.jsx` (bloco inteiro de
    ~600 linhas com `addTextAnimation`/`copyTextAnimation`/
    `pasteTextAnimation`/`removeTextAnimation`/`readTextRevealDirection`/
    `setTextRevealDirection` e todos os helpers exclusivos deles, mais os
    6 exports `$.global.*` correspondentes e duas referências soltas em
    comentários de `captureStyleNode` que citavam `applyDirectionLabel`) e
    `styles.css` (`.text-anim-hint`, `.text-anim-row`,
    `.action-button.danger:hover`). **Nada compartilhado foi tocado**:
    `openChoicePicker`/`closeChoicePicker`/`buildChoicePicker`,
    `.tx-font-row`/`.tx-font-trigger`/`.tx-chevron`,
    `currentSelectedLayerKey`/`lastLayerKeyForText` continuam servindo
    outras features normalmente. Um backup completo do código antigo foi
    salvo antes de apagar (`text-reveal-tab-backup.md`, raiz do projeto),
    depois removido a pedido do próprio usuário quando ele confirmou que
    está reformulando a feature do zero e não precisava mais dele --
    então essa versão antiga **não existe em lugar nenhum** a partir de
    agora (nem neste repo sem controle de versão), só o que está
    resumido aqui e no README.
34. **A remoção do item 33 quebrou uma função de verdade em produção sem
    eu perceber na hora: `numberOr()` era genérica, não exclusiva do
    Text Reveal, mas morava dentro do bloco apagado.** `applyStylePresetToLayer`
    (Style Presets, usado pela aba Captions) e `createCaptionLayers`
    ("Add captions", a própria criação das legendas) dependiam dela --
    ambas continuaram chamando `numberOr(...)` depois que a função sumiu,
    o que quebrava "Add captions" com `ReferenceError: Function numberOr
    is undefined` toda vez que era usado. Só descobri ao testar ao vivo
    uma feature NOVA (item 35) que também chamava `numberOr` -- a
    variedade de nomes que eu tinha varrido pra confirmar "isso é
    exclusivo do bloco Text Reveal" (ver item 33) não incluiu esse nome
    porque ele soa genérico demais pra "parecer" que precisava de
    checagem -- exatamente o oposto do certo: nomes genéricos são os que
    mais merecem checagem, porque são os mais prováveis de serem
    reaproveitados por código não relacionado. **Corrigido** recriando
    `numberOr(value, fallback)` como helper de verdade genérico, perto
    de `stringify`/`parse`/`activeComp` no topo do arquivo (não mais
    dentro de nenhum bloco de feature específica). **Lição geral pra
    qualquer remoção de bloco de código futura**: depois de confirmar
    que ele é uma unidade autocontida, vale um segundo grep -- um por
    símbolo -- em vez de confiar só num sweep visual de "isso parece
    exclusivo daqui".
35. **Kit tab ganhou um segundo "tipo" de preset: "layer group"** --
    diferente de `KIT_PRESET_HANDLERS` (que só modifica camada(s) já
    selecionada(s)), esse tipo **cria camada(s) novas do zero** e insere
    na composição ativa, ancoradas no playhead atual, sem precisar de
    nada selecionado -- pedido explícito do usuário: "eu mesmo vou
    animar as camadas e pedir pra você implementar", e "às vezes também
    vou querer adicionar comps inteiras" (isso último ainda não
    implementado -- só o caso de "algumas camadas", não "uma comp
    inteira", por enquanto). Arquitetura: `captureLayerStylePreset`
    (Style Presets) foi refatorada pra extrair `captureLayerStyleParts`
    (efeitos + text animators + transform + text style de UMA camada --
    o miolo reaproveitável), usada tanto por ela quanto pela função nova
    `captureSingleLayerTemplate` (adiciona nome/texto/inPoint/outPoint --
    o que falta pra CRIAR uma camada do zero, não só reaplicar num alvo
    já existente). `captureKitLayerGroupFromNames(namesJson)` -- só pra
    uso do desenvolvedor/Claude, não exposta na UI -- acha camadas por
    nome na comp ATIVA e devolve os templates completos, cada um com
    `offset` (tempo relativo à camada mais cedo do grupo, preserva o
    escalonamento entre elas) e `duration`. `KIT_LAYER_GROUP_PRESETS` guarda
    o resultado colado à mão depois de uma captura ao vivo.
    `createLayerFromKitTemplate` cria a camada (`comp.layers.addText`),
    posiciona no tempo (`startTime`/`inPoint`/`outPoint`, mesma ordem já
    testada em `createCaptionLayers` -- `inPoint` desloca `outPoint`
    junto, então `outPoint` precisa ser setado por último) e **reaproveita
    `applyStylePresetToLayer` sem nenhuma mudança** pra aplicar efeitos/
    animators/transform/estilo de texto -- o mesmo timeOffset relativo a
    `layer.inPoint` que já funciona pra Style Presets também re-ancora
    corretamente uma camada recém-criada. `applyKitLayerGroupPreset(id)`
    é o dispatcher exportado, análogo a `applyKitPreset` mas sem exigir
    seleção (só uma comp ativa). No painel, `KIT_PRESETS` ganhou um
    campo opcional `kind: "layers"` (ausente = comportamento antigo,
    "modify"); o clique na tile decide entre `applyKitPreset` e
    `applyKitLayerGroupPreset` com base nisso. **Primeiro preset desse
    tipo**: `"text-duo-intro"` ("Duo Intro", categoria Text reveal) --
    capturado ao vivo das camadas "Animado" e "Texto" (comp "WAZ_01" do
    projeto real do usuário), que usam TextEvo (Pseudo Effect com
    parâmetro "Strength" animado por 2 keyframes + Text Animator
    dirigido por expressão) -- o mesmo padrão que os Style Presets já
    sabiam capturar/reaplicar corretamente (incluindo o fix do item
    32/Fill Color, que se aplica aqui automaticamente por reaproveitar
    `applyStyleChildren`/`applyStylePresetToLayer` sem mudança nenhuma).
    **Testado ao vivo em duas camadas**: criada uma comp descartável
    (`MF_TEST_KIT_LAYERS`/`MF_TEST_KIT_UI`, removida ao final de cada
    teste), playhead movido pra um tempo != 0, clique real na tile
    "Duo Intro" pela UI (não só chamada direta a `evalScript`) --
    confirmado que as 2 camadas aparecem no tempo certo (ancoradas no
    playhead, escalonamento de ~0.167s entre elas preservado), TextEvo
    com os 2 keyframes de Strength reancorados certinho, e a expressão
    do Text Animator presente (`positionHasExpr: true`) -- sem
    regressão do bug do item 32. **Pra adicionar um novo preset desse
    tipo no futuro**: usuário anima as camadas de verdade numa comp
    (de teste ou de projeto), pede pra capturar; eu chamo
    `captureKitLayerGroupFromNames(["Nome1","Nome2",...])` ao vivo
    (recarregando `host.jsx` primeiro com `$.evalFile`), colo o array
    `layers` resultante como mais uma entrada em
    `KIT_LAYER_GROUP_PRESETS`, e adiciono a tile correspondente em
    `KIT_PRESETS` (panel.js) com `kind: "layers"`.
36. **Kit tab ganhou uma barra fixa embaixo (footer), igual a aba Home, com
    2 botões: "Preset layers" e "Preset comp"** -- self-service, sem
    precisar mais me chamar pra colar JSON à mão em `host.jsx` (item 35
    virou a base disso, não foi substituído: os presets curados
    continuam existindo do mesmo jeito, isso só some um caminho NOVO,
    paralelo, pro usuário salvar os dele). Persistência é client-side em
    `localStorage` (`motionfilm-kit-presets`), exatamente como os Style
    Presets já fazem -- não em `host.jsx`, que só sabe dos presets
    curados. Fluxo ao clicar num dos botões: (1) `hostCall` captura a
    partir da seleção (`captureKitLayerGroupFromSelection`, "Preset
    layers") ou da comp ativa (`captureKitCompReference`, "Preset comp");
    (2) se der certo, abre o `openChoicePicker` já existente perguntando
    "qual grupo" (uma das 4 `KIT_CATEGORIES`) -- pedido explícito do
    usuário, primeira coisa perguntada; (3) depois abre o `openNamePopover`
    já existente (o mesmo do "Save Style Preset") perguntando o nome; (4)
    salva `{id, kind, category, label, data}` em `localStorage` e
    re-renderiza a grade. **"Preset comp" não faz captura profunda de
    propriedade nenhuma** -- só guarda o NOME da composição ativa;
    aplicar (`applyKitCompData`) localiza esse nome em `app.project` e
    usa `targetComp.layers.add(sourceItem)` (a mesma operação nativa de
    arrastar do painel Project), ancorado no playhead via `startTime`.
    Decisão deliberada, não uma limitação temporária: uma composição é um
    ativo de projeto (referencia footage em disco, outras comps) que não
    dá pra reconstruir de um JSON genérico do jeito que uma camada de
    texto dá -- então um preset de comp **só funciona de volta no mesmo
    projeto** em que foi salvo, ao contrário de um preset de camadas
    (que é 100% portátil, JSON puro). Renderização: `getAllKitPresets()`
    (panel.js) funde `KIT_PRESETS` (curados) com os salvos em
    `localStorage`, cada um normalizado pro mesmo formato de tile; o
    clique na tile decide entre 4 caminhos (`applyKitPreset` por id,
    `applyKitLayerGroupPreset` por id, `applyKitLayerGroupData` com o
    JSON direto, `applyKitCompData` com o nome direto) -- só os dois
    `...Data` são exclusivos de presets salvos pelo usuário, já que só o
    painel tem acesso ao `localStorage`. Em `host.jsx`,
    `applyKitLayerGroupPreset`/`applyKitLayerGroupData` foram refeitos
    pra compartilhar o mesmo núcleo (`applyKitLayerGroupList`), e
    `captureKitLayerGroupFromNames`/`captureKitLayerGroupFromSelection`
    compartilham `buildKitLayerTemplates`. **Testado ao vivo** (comp de
    origem descartável com 2 camadas de texto -- uma com Drop Shadow,
    outra sem, escalonadas por 0.5s -- e uma comp de destino separada,
    ambas removidas ao final): clique de verdade nos 2 botões do footer,
    nos itens reais do choice-picker e do name-popover (não chamada
    direta a hostCall), preset de camadas aplicado numa comp diferente
    da de origem com playhead != 0 -- as 2 camadas vieram na comp certa,
    no tempo certo, com o Drop Shadow preservado só na que tinha;
    preset de comp aplicado -- a comp de origem apareceu como camada na
    comp de destino, ancorada no playhead, `isCompLayer: true`
    confirmado via `layer.source instanceof CompItem`.
37. **Terceiro botão no footer do Kit: "Delete preset"** -- só lista
    presets SALVOS PELO USUÁRIO (`loadKitCustomPresets()`); os curados
    (`KIT_PRESETS`/`KIT_LAYER_GROUP_PRESETS`, embutidos no código) nunca
    aparecem na lista, então não tem como apagar um deles sem querer por
    essa via. Clique abre o mesmo `openChoicePicker` genérico, listando
    `"Nome (Categoria)"` de cada um; escolher um remove **imediatamente**
    (sem `confirm()` nativo -- mesmo padrão já usado no botão "Delete" do
    modal "Manage Style Presets", e evita de propósito o `window.confirm`/
    `alert` que trava o painel, documentado no item 21 desta lista). Se
    não existir nenhum preset salvo, mostra status de erro
    ("No saved Kit presets to delete yet.") sem abrir nada.
    **Bug real encontrado e corrigido durante o teste ao vivo**: o
    primeiro clique não abria o picker -- `openChoicePicker` roda
    SÍNCRONO dentro do handler de clique do botão (ao contrário do "Preset
    layers"/"Preset comp", que só abrem o picker de dentro do callback
    assíncrono de um `hostCall`, bem depois do clique original já ter
    terminado de borbulhar). Sem `event.stopPropagation()`, o mesmo
    clique que abre o picker continua subindo até o listener genérico em
    `document` (linha ~2548) que fecha TODOS os popovers/pickers abertos
    a cada clique -- resultado: o picker abria e fechava no mesmo evento,
    sem erro nenhum no console (silencioso). Mesmo padrão de bug (e
    mesmo fix) já usado antes no antigo picker de Direction do Text
    Reveal (`event.stopPropagation()` logo no início do handler, antes
    de chamar `openChoicePicker`). **Corrigido** adicionando
    `event.stopPropagation()` no início do handler do botão Delete.
    **Testado ao vivo, usando a própria feature pra apagar um preset de
    teste real** que o usuário tinha criado à mão em Effects
    ("Loucura"): picker mostrou exatamente `"Loucura (Effects)"`, clique
    removeu do `localStorage` (`[]` depois), grade da categoria Effects
    voltou a mostrar "No presets in this category yet.", e o caso "nada
    pra apagar" (clicar de novo depois de já ter zerado) mostrou o status
    de erro certo sem abrir picker vazio. **UX redesenhada logo em
    seguida -- ver item 38**: o usuário achou que faltava um jeito de
    "entrar no grupo e ver os presets" antes de escolher qual apagar; o
    picker-por-nome deste item foi substituído.
38. **Botão "Delete preset" redesenhado: primeiro passo agora é o MESMO
    picker de categoria do fluxo de salvar** (não mais uma lista de
    nomes) -- escolher o grupo entra em "modo de exclusão" nesse grupo,
    e apagar um preset específico passa a ser **segurar o botão esquerdo
    do mouse por 3 segundos em cima da tile**, com o nome tremendo
    (`kitPresetShake`, CSS) o tempo todo em que está sendo segurado.
    Soltar antes de completar cancela sem apagar nada -- sem clique
    nenhum envolvido no apagar em si, e sem `confirm()` nativo. Estado:
    `kitDeleteMode` (booleano, `client/panel.js`), armado só pelo botão
    Delete (`openChoicePicker` com as 4 categorias, igual
    `promptSaveKitPreset`); enquanto ativo, o clique normal de aplicar
    preset (`tile.click`) é ignorado por completo -- só o hold de 3s
    (`mousedown` + `window.setTimeout(3000)`, cancelado em `mouseup`/
    `mouseleave`) faz alguma coisa, e só em tiles de presets **salvos
    pelo usuário** (`preset.custom === true`) -- segurar numa tile
    curada (Fade In, Duo Intro) em modo de exclusão não faz nada, de
    propósito, já que essas não têm de onde ser removidas. `kitDeleteMode`
    é cancelado automaticamente em 3 situações, todas testadas ao vivo:
    (a) um apagar bem-sucedido; (b) trocar de categoria pela barra lateral
    (mesmo clicando na categoria JÁ ativa -- clicar uma categoria sempre
    significa "só navegando", cancela o modo mesmo sem trocar de grupo);
    (c) sair da aba Kit pra qualquer outra aba (`initPageTabs`). **Testado
    ao vivo, ponta a ponta**: preset novo salvo em "Shapes", botão Delete
    → picker de categoria → "Shapes" → clique confirmado como
    ignorado (`.click()` não aplica nada) e só o hold conta; segurar
    100ms e soltar → classe `is-deleting-armed` (borda/tremida) aparece e
    some, preset continua salvo; segurar os 3s completos → preset
    removido do `localStorage`, tile some da grade, status "Deleted
    “X”." aparece. Também testado: segurar numa tile curada em modo de
    exclusão não faz nada (clique nela também não aplica -- confirmado
    pelo status ficar inalterado); trocar de categoria pela barra lateral
    cancela o modo (confirmado clicando a mesma tile curada DEPOIS da
    troca -- voltou a aplicar normalmente, erro esperado "Select at
    least one layer first." por não ter camada selecionada, prova de que
    o clique chegou na lógica normal de novo).
39. **Kit tab: prévia de vídeo real, gerada automaticamente ao salvar um
    preset** -- antes disso, o mecanismo de vídeo já existia (item 34 da
    seção anterior desta sessão) mas dependia de alguém exportar um
    clipe manualmente e soltar na pasta certa; nunca ninguém fez isso,
    então toda tile sempre caía no placeholder de CSS. Pedido do
    usuário: "olha o BadFX e vê como ele faz". **Investigação (sem
    copiar nada de terceiros)**: o BadFX (`com.badedits.cep`, instalado
    em `.../CEP/extensions/`) tem debug remoto habilitado
    (`.debug` → porta 8860 pro AEFT) -- inspecionei só estrutura/
    comportamento via CDP (nunca o código-fonte/assets deles). Achado:
    cada tile deles é um `<img>` (poster) + `<video muted loop
    preload="metadata">` (pausado, toca só no `mouseenter`) -- **exatamente
    igual ao mecanismo que a extensão já tinha** (só que eles carregam
    os arquivos como Blob, provavelmente por proteção de conteúdo pago;
    pra nós, arquivo estático já era suficiente). Ou seja: o mecanismo
    de exibição nunca precisou mudar -- faltava só GERAR os arquivos.
    **Pipeline de renderização construído** (`renderKitPreviewClip` em
    `host.jsx`, `generateKitPresetPreview`/`captureKitPreviewPoster` em
    `panel.js`), disparado automaticamente logo depois de salvar um
    preset pelo footer:
    - AE cria uma comp temporária (kind "layers": tamanho/fps = os
      capturados em `compWidth`/`compHeight`/`compFrameRate`, novos
      campos adicionados a `captureKitLayerGroupFromSelection`/
      `captureKitLayerGroupFromNames` -- necessários porque Position/
      Scale capturados são valores absolutos em pixel, ficam errados
      numa comp de tamanho diferente da original) ou usa a comp real
      direto (kind "comp", sem duplicar -- renderizar não altera nada).
    - Vai pra Render Queue, `timeSpanStart`/`timeSpanDuration` limitam a
      duração renderizada a no máximo 2.5s (`KIT_PREVIEW_MAX_DURATION`)
      **mesmo que a comp/animação real seja bem mais longa** -- confirmado
      ao vivo: renderizei uma comp de 10s pedindo 1s e o arquivo final
      tinha exatamente 1s (`video.duration` conferido depois de
      carregado, não só a propriedade ecoada de volta pelo script).
    - Template de Output Module escolhido dinamicamente
      (`pickH264OutputTemplate`, procura em `om.templates` por algo tipo
      "H.264" com "5 Mbps" de preferência) em vez de string fixa --
      o nome exato varia por versão/idioma do AE, então hardcoded
      quebraria em outra máquina (lição direta do "vou testar em outro
      computador" de uma sessão anterior).
    - **Descoberta que mudou o plano inteiro**: cheguei a cogitar reusar
      o ffmpeg já usado pela aba Captions (webm/VP9, já comprovado
      funcionando) pro vídeo final, igual ao README antigo da pasta
      dizia. Testei ao vivo primeiro se um `.mp4` renderizado pelo
      template nativo "H.264 - Match Render Settings" do PRÓPRIO AE
      tocava no Chromium do painel -- **tocou perfeitamente**
      (`loadeddata`/`canplay`/`play()` todos dispararam limpo, sem
      `error`). Isso é um encoder DIFERENTE do `libopenh264` do ffmpeg
      bundled (que não funciona bem aqui, item 26 documentado antes) --
      não é uma contradição daquele achado, é uma ferramenta diferente
      pro mesmo problema. **Resultado: o pipeline inteiro não depende de
      ffmpeg nenhum** -- nem pro vídeo (AE renderiza `.mp4` direto no
      destino final) nem pro poster (`<canvas>` tira um frame do próprio
      `.mp4` já renderizado via `drawImage`+`toDataURL`, salvo com
      `fs.writeFileSync` -- mesma técnica de captura de frame real já
      confirmada antes nesta sessão pro debug do vídeo do Kit). Convenção
      de arquivo mudou de `.webm` pra `.mp4` (README da pasta reescrito).
    - **Bug de CSS real encontrado e corrigido durante o teste ao vivo**:
      o primeiro preset gerado renderizou/salvou os arquivos certinho no
      disco (conferido via `File.exists`/`.length` direto no AE, tamanhos
      não-triviais), mas a tile ficava com o preview colapsado em 0×0 --
      invisível. Causa: `.kit-preset-preview:not(.no-thumb) .kit-swatch {
      display: none; }` esconde o placeholder de CSS assim que a mídia
      real carrega (comportamento correto, intencional) -- mas isso
      também remove o único filho em fluxo normal da caixa, e
      `aspect-ratio: 16/9` sozinho (sem `width` explícito) não conseguiu
      mais derivar um tamanho via `align-items: stretch` do pai flex
      column, colapsando tudo pra 0. **Corrigido** adicionando `width:
      100%` explícito em `.kit-preset-preview`, dando ao `aspect-ratio`
      um valor definido independente do conteúdo. Confirmado ao vivo:
      `getBoundingClientRect()` foi de `{w:0,h:0}` pra `{w:126,h:70.875}`
      (proporção 16:9 exata) depois do fix.
    - **Limitação real descoberta ao vivo, pré-existente (não desta
      mudança)**: `createLayerFromKitTemplate` só sabe recriar camadas
      de TEXTO (`comp.layers.addText(...)`, sempre) -- um preset "Preset
      layers" salvo a partir de uma camada sólida/forma captura as
      propriedades de Transform normalmente, mas ao reaplicar (inserir
      OU renderizar prévia) vira uma camada de texto vazia (invisível).
      Descoberto testando o pipeline novo com uma camada sólida de
      propósito (prévia saiu toda preta) -- confirmado que NÃO é bug do
      pipeline de renderização testando de novo com uma camada de texto
      de verdade, que funcionou perfeitamente (prévia mostrou o texto
      real renderizado). Esse limite já existia desde a criação de
      `captureSingleLayerTemplate`/`createLayerFromKitTemplate` (a
      função sempre foi pensada pro caso de uso real -- "Duo Intro",
      texto com TextEvo -- nunca formas/sólidos); só ficou visível agora
      porque antes não havia como "ver" o resultado sem inserir de
      verdade numa comp. **Não corrigido** -- fica documentado como
      limitação conhecida pra quando "Preset layers" com formas/sólidos
      for pedido de verdade.
    - **Testado ao vivo, ponta a ponta, com o texto real**: `hostCall`
      "Preset layers" numa camada de texto amarela "HELLO" numa comp
      preta → renderização automática → status "Preview rendered." →
      screenshot confirmou a tile mostrando o "HELLO" amarelo de
      verdade, não um placeholder. Todos os comps/presets/arquivos de
      teste removidos ao final (comps de teste, entradas de
      `localStorage`, `.mp4`/`.jpg` gerados) -- só ficou o `README.md`
      na pasta `assets/kit-previews/`.
40. **Dois feedbacks reais do usuário sobre o Kit tab, os dois
    corrigidos e testados ao vivo**:
    - **(a) Apagar um preset não apagava a prévia** -- o hold-to-delete
      (item 38) só removia a entrada do `localStorage`; o `.mp4`/`.jpg`
      gerados (item 39) ficavam órfãos em `assets/kit-previews/` pra
      sempre. Corrigido com `deleteKitPreviewFiles(id)` (`client/panel.js`,
      `fs.unlinkSync` em cada um dos dois, com `existsSync` antes e
      `try/catch` em volta -- não existir ainda, ou o render ter falhado
      antes de gerar algum dos dois, é esperado e não deve quebrar o
      apagar do preset em si), chamada logo antes de remover a entrada
      do `localStorage` no timer de 3s. **Testado ao vivo**: salvou um
      preset, confirmou os dois arquivos existindo no disco, apagou
      pelo hold de 3s, confirmou os dois `File.exists` virando `false`.
    - **(b) Scale estático (sem keyframe/expressão) não vinha no "Preset
      layers"** -- veio de `STYLE_PRESET_ALWAYS_CAPTURE_TRANSFORM`
      (Position/Anchor Point só, ver item ~32 de uma sessão anterior),
      pensado especificamente pro caso de uso dos Style Presets
      (Captions): lá, forçar Scale/Rotation/Opacity em toda legenda que
      recebe o preset poderia brigar com um tamanho que aquela legenda
      específica precisava manter. Kit "Preset layers" é um caso
      diferente -- não existe "camada existente" nenhuma pra proteger,
      já que o preset CRIA uma camada nova do zero; o objetivo é
      reproduzir a aparência exata da original, animada ou não.
      **Corrigido**: `captureLayerStyleParts` ganhou um segundo
      parâmetro opcional (`alwaysCaptureMatchNames`, default
      `STYLE_PRESET_ALWAYS_CAPTURE_TRANSFORM` -- Style Presets/Captions
      continuam se comportando exatamente como antes, sem nenhuma
      mudança), e `captureSingleLayerTemplate` (Kit) passa um conjunto
      maior, `KIT_ALWAYS_CAPTURE_TRANSFORM` (Position, Anchor Point,
      Scale, Rotate Z, Opacity). **Testado ao vivo**: camada de texto
      com Scale `[150,150,100]` setado à mão (sem keyframe nenhum) →
      capturado no JSON do preset salvo (confirmado lendo o
      `localStorage` de volta) → aplicado numa comp de destino nova →
      camada resultante confirmada com `[150,150,100]` de verdade (não
      o `[100,100,100]` padrão que vinha antes da correção).
41. **Os dois presets curados que existiam ("Fade In", "Duo Intro")
    foram removidos a pedido do usuário** -- eram presets de teste da
    fase de desenvolvimento do sistema; agora que "Preset layers"/
    "Preset comp" (self-service, item 36) funcionam de ponta a ponta com
    prévia de vídeo real (item 39), o usuário vai salvar os presets de
    verdade direto pela UI, sem precisar mais de nenhum curado
    hard-coded. Removido: `KIT_PRESET_HANDLERS["text-fade-in"]` e
    `KIT_LAYER_GROUP_PRESETS["text-duo-intro"]` (`host.jsx`, ambos os
    objetos ficaram vazios -- `{}` -- não removidos por completo, já que
    a infraestrutura de dispatch por id continua útil se algum preset
    curado for adicionado à mão no futuro); as duas entradas
    correspondentes em `KIT_PRESETS` (`client/panel.js`, array também
    ficou vazio -- `[]`); e o CSS exclusivo de "Duo Intro"
    (`.kit-swatch.kit-anim-duo-intro` + `@keyframes kitPreviewDuoIntro`)
    -- `.kit-anim-fade-in`/`kitPreviewFadeIn` **não** foram removidos,
    já que esse continua sendo o placeholder genérico de CSS reusado por
    QUALQUER preset "layers" recém-salvo enquanto a prévia de vídeo real
    ainda não terminou de renderizar (`getAllKitPresets`). **Testado ao
    vivo**: recarreguei painel + host.jsx, a grade da aba Kit passou a
    mostrar só o preset real que o usuário já tinha salvo sozinho pela
    UI nova (`"WAZ_01"`, com a prévia de vídeo real funcionando) -- prova
    de que a remoção não afetou presets salvos pelo usuário, só os dois
    hard-coded no código.
42. **Três feedbacks reais do usuário sobre a prévia do Kit, todos
    corrigidos e testados ao vivo**:
    - **(a) Bug: a prévia "sumia e ficava cinza" ao tirar o mouse de
      cima da tile.** Causa: o CSS fazia `.kit-preset-thumb` (poster) e
      `.kit-preset-video` fazerem crossfade de opacidade em direções
      opostas (`.is-playing` liga o vídeo em 1 E desliga o poster pra
      0, ao mesmo tempo) -- numa transição real (não instantânea, .15s),
      existe uma janela genuína onde NENHUM dos dois está totalmente
      opaco, revelando o fundo escuro de `.kit-preset-preview` por
      baixo. Mais visível num clipe pesado/lento de decodificar (o vídeo
      demora mais pra voltar a ficar visível de verdade). **Corrigido**
      trocando o design: o poster agora fica SEMPRE opaco (nunca mais
      desliga), e só o vídeo tem opacidade animada por cima dele --
      trocada a ordem de inserção no DOM (`preview.appendChild(thumb);
      preview.appendChild(video);`, vídeo por último = pinta por cima) e
      removida a regra CSS que desligava o poster durante o play. Elimina
      a classe inteira de bug por construção -- não existe mais um
      estado onde os dois ficam transparentes ao mesmo tempo, já que o
      poster não depende mais de nenhuma transição. **Testado ao vivo**:
      5 ciclos rápidos de mouseenter/mouseleave (80-200ms de intervalo,
      estresse de verdade) -- `thumbOpacity` ficou em `"1"` o tempo
      inteiro em TODAS as rodadas, nunca dipou.
    - **(b)/(c) Overlay de tela cheia com o mascote da produtora
      enquanto a prévia renderiza.** Pedido: igual ao overlay que já
      existe nas Caption Settings (`.modal-overlay`, dim+blur cobrindo o
      painel inteiro) -- reaproveitado como está, sem duplicar CSS, só
      um novo `<div id="kit-render-overlay" class="modal-overlay">` sem
      `.modal-panel` dentro, só o `<video>` do mascote. Chamado por
      `showKitRenderOverlay()`/`hideKitRenderOverlay()` em volta de
      `generateKitPresetPreview` (mostra antes do `hostCall` de
      renderização, esconde tanto no sucesso quanto na falha). O usuário
      mandou 2 formatos do vídeo do mascote: `ROSTO.mp4` (369KB, mascote
      verde sobre fundo preto sólido) e `ROSTO_1.mov` (9.8MB, canal
      alpha de verdade -- ~26x mais pesado). Escolhido o **MP4 +
      `mix-blend-mode: screen`** no CSS: preto contribui zero na
      composição "screen" (resultado = 1-(1-a)(1-b), e `a=0` anula o
      termo), então o fundo preto simplesmente some, revelando o que
      estiver atrás (o backdrop já escurecido/borrado do overlay) -- só
      o mascote verde aparece, sem canvas, sem WebGL, sem decodificar
      alpha nenhum. Copiado como `client/assets/mascot-loading.mp4`
      (o `.mov` mais pesado NÃO foi usado -- ficou só no Downloads do
      usuário). **Testado ao vivo**: o `.mp4` carrega e toca limpo
      (3840x2160, ~1.2s, `loadedData`/`canplay`/`play()` sem erro,
      confirmado antes disso pro `.mp4` das prévias em si -- mesmo
      encoder H.264 do AE, mesma conclusão); screenshot com zoom
      confirmou o mascote compositando limpo sobre o fundo escuro do
      painel, sem caixa preta nenhuma ao redor. Fluxo completo testado
      com um preset real: `overlayVisibleDuringRender: true` e
      `mascotPlayingDuringRender: true` checados no meio do
      processamento (timing preciso via `await` dentro do mesmo script,
      não por screenshot -- a renderização real é rápida demais, ~1-2s,
      pra pegar por round-trips separados de CDP); depois de terminar,
      `overlayHiddenAfterDone: true` e `mascotPausedAfterDone: true`.
43. **Dois ajustes finos no item 42, pedidos pelo usuário depois de ver o
    resultado ao vivo**:
    - **(a) O mascote tocava em loop durante TODO o processamento** (o
      que o item 42 tinha implementado de propósito, mas era o
      comportamento errado) **em vez de tocar uma vez só na confirmação
      de sucesso.** Reinterpretação do pedido original: "ao finalizar a
      ação de adicionar a prévia" queria dizer "no momento em que a
      prévia termina de ser adicionada" (uma animação de confirmação),
      não "durante o processo inteiro" (um indicador de carregamento).
      **Corrigido**: removido `loop` do `<video id="kit-render-mascot">`
      (`index.html`); `showKitRenderOverlay`/`hideKitRenderOverlay`
      (chamadas em volta do `hostCall` de render) viraram
      `playKitMascotConfirmation()`, chamada só uma vez, só no branch de
      sucesso completo (`posterOk` true, junto do
      `setStatus("Preview rendered.", "success")`) -- nunca durante o
      render em si, nunca no branch de erro. `playKitMascotConfirmation`
      mostra o overlay, dá play, e se auto-esconde no evento `ended` do
      próprio vídeo (listener de uma vez só, removido depois de disparar)
      -- não depende de nenhum timer/duração hardcoded. **Testado ao
      vivo com um preset real**: `overlayDuringRender.hidden: true`
      confirmado enquanto o status ainda dizia "rendering preview…" (
      nada aparece durante o processamento); depois,
      `sawMascotPlayingAfterStatus: true` e `mascotLoopAttribute: false`
      confirmados; ao final, `finalOverlayHidden: true` e `sawEnded:
      true` -- confirma que o esconder aconteceu via o evento `ended`
      de verdade, não por timeout.
    - **(b) Prévia da tile do Kit ~60% maior.** Grid media 128px de
      largura por tile (2 colunas fixas, `repeat(2, 1fr)`) -- 128*1.6 ≈
      205px. Trocado pra `grid-template-columns: repeat(auto-fill,
      205px)` (`.kit-presets`, `styles.css`). **Duas tentativas, a
      primeira corrigida ao vivo**: usar `minmax(205px, 1fr)` (auto-fill
      com esticamento) resultou em tiles de ~264px -- como só uma
      coluna cabe na largura atual do painel (428px de janela, ~264px
      de área útil de grid), o `1fr` esticava a única coluna pra
      preencher todo o espaço sobrando, dando **+106%** em vez dos
      **+60%** pedidos. **Corrigido** trocando pra colunas de largura
      FIXA (sem `1fr`) -- `getBoundingClientRect()` confirmou exatamente
      `205px` depois do ajuste, batendo com o cálculo. `auto-fill`
      mantido (não virou `repeat(1, 205px)` fixo) pra continuar
      responsivo: um painel destacado/mais largo automaticamente cabe
      2+ colunas do mesmo tamanho de 205px, em vez de esticar pra outro
      tamanho.
44. **Dois ajustes finos no item 43, o usuário mandou print marcando o
    tamanho exato que queria nos dois casos**:
    - **(a) Tile do Kit voltou grande demais** -- os 205px do item 43(b)
      ficaram grandes na prática (com conteúdo de vídeo real dentro,
      diferente de quando só existia o placeholder). Pedido: menor, até
      caber 2 lado a lado no mesmo espaço -- e o print mostrava as duas
      caixas marcadas somando quase exatamente a largura que uma tile de
      205px ocupava sozinha. Medido ao vivo: área útil da grade tem
      263px (`getBoundingClientRect` de `#kit-presets`) -- pra 2 colunas
      com 8px de gap, `2x + 8 = 263` → `x ≈ 128px`, ou seja, **o tamanho
      original de antes do item 43(b)**. **Corrigido** voltando
      `grid-template-columns` pra `repeat(auto-fill, 128px)` (mesma
      estrutura `auto-fill` de largura fixa do item 43(b), só o número
      mudou) -- `getBoundingClientRect()` confirmou `128px` exato depois
      do reload.
    - **(b) Mascote da confirmação (item 42/43a) ficou pequeno demais**
      -- media 200px/max-width 55%, o usuário pediu bem maior, perto do
      tamanho marcado no print (uma caixa ocupando a maior parte da
      largura do painel). Painel mede 407px de largura
      (`.app-shell.getBoundingClientRect()`). **Corrigido** pra
      `width: 320px; max-width: 85%` (antes `200px`/`55%`) -- 320px é o
      alvo de verdade, 85% só entra como teto de segurança se o painel
      estiver mais estreito que o normal. **Testado ao vivo**: como o
      mascote só aparece por ~1.2s na confirmação de sucesso (rápido
      demais pra flagrar por screenshot via CDP com round-trips
      separados, mesma limitação já documentada no item 42), a medição
      foi feita com um loop de `await` dentro do PRÓPRIO script,
      testando `!overlay.hidden && !mascotVideo.paused` a cada 150ms até
      pegar o momento certo, e só então lendo
      `getBoundingClientRect()` -- confirmado `318.75×179.3px` (a
      pequena diferença de `320` é só o object-fit/aspect-ratio natural
      do vídeo, não max-width entrando em ação, já que `407×0.85≈346 >
      320`).
45. **`mix-blend-mode` não funciona NADA nesse Chromium do CEP -- não é
    um problema de `<video>`, não é um problema de `backdrop-filter`,
    é a propriedade inteira não compositando.** O usuário reportou que o
    fundo preto do mascote (itens 42-44) continuava visível de verdade,
    não sumia. Investigação em 3 passos, cada um eliminando uma hipótese:
    - **Passo 1** -- segurei o `<video>` num frame parado (`currentTime`
      + `pause()`, sem depender de flagrar os ~1.2s da confirmação por
      screenshot) e tirei print: **caixa preta sólida visível ao redor
      do mascote**, apesar de `getComputedStyle(video).mixBlendMode`
      confirmar `"screen"` -- a propriedade estava setada, mas não
      compositava.
    - **Passo 2** -- hipótese: `<video>` usa um caminho de composição
      via hardware separado que ignora blend modes CSS (limitação real e
      documentada em outros navegadores, mais provável ainda num arquivo
      4K como esse). Reescrito pra desenhar cada frame num `<canvas>`
      via `drawImage()` + `requestAnimationFrame`, com `mix-blend-mode`
      no canvas em vez do vídeo -- canvas 2D deveria sempre passar pelo
      pipeline normal de composição. **Resultado: mesma caixa preta
      sólida**, sem nenhuma mudança visual.
    - **Passo 3** -- teste decisivo, isolando a variável: uma `<div>`
      branca simples com `mix-blend-mode: difference` (branco com
      difference contra QUALQUER fundo nunca deveria continuar branco
      puro), testada em dois lugares ao mesmo tempo -- uma dentro do
      `#kit-render-overlay` (que tem `backdrop-filter`), outra
      `position:fixed` direto no `<body>`, sem overlay nem
      `backdrop-filter` nenhum por perto. **As duas renderizaram branco
      sólido, sem blend nenhum.** Conclusão: `mix-blend-mode` não
      composita em NENHUM contexto deste build de Chromium/CEP -- não é
      específico de vídeo, não é específico de `backdrop-filter`, é a
      feature inteira que não funciona aqui.
    - **Corrigido de verdade** abandonando CSS blend mode por completo e
      implementando chroma-key manual por pixel: cada frame desenhado
      num `<canvas>` OFFSCREEN, `getImageData()` lido, e pra cada pixel
      `alpha = Math.max(r, g, b)` -- preto genuíno (r=g=b=0) vira
      alpha=0 (transparente de verdade), uma cor saturada (o verde do
      mascote) fica com alpha alto (quase opaco), bordas com
      anti-aliasing saem com alpha intermediário automaticamente.
      Matematicamente é o mesmo resultado que "screen contra um destino
      preto" produziria -- só calculado à mão com canal alpha real em
      vez de depender de uma feature CSS que esse build não aplica. O
      resultado (`ctx.putImageData`) vai pro `<canvas>` visível, sem
      `mix-blend-mode` nenhum envolvido -- não precisa mais dele.
      **Testado ao vivo**: pixel de canto do canvas resultado lido via
      `getImageData` -- `[0,0,0,0]` (alpha genuinamente zero, não só
      "parece preto"); screenshot com o vídeo pausado no mesmo frame de
      antes confirmou visualmente **nenhuma caixa preta** -- o mascote
      aparece flutuando sobre o conteúdo desfocado do painel atrás dele,
      exatamente como pedido desde o início. Fluxo completo (salvar
      preset real → aguardar render → aguardar a confirmação tocar e
      esconder sozinha) testado de novo do zero depois da reescrita,
      confirmado funcionando ponta a ponta.
46. **Dois feedbacks reais do usuário, ambos corrigidos e testados ao
    vivo**:
    - **(a) Spinner de carregamento (igual ao da aba Captions) durante o
      render, fundo já borrado/escuro desde o início, some quando a
      animação do mascote começa.** Antes disso, o overlay só aparecia
      no MOMENTO da confirmação de sucesso (item 43a) -- durante o
      render de verdade (que pode levar alguns segundos) não aparecia
      nada. Pedido: mostrar o overlay (dim+blur) desde o INÍCIO do
      render, com um spinner igual ao `.captions-spinner` já existente
      na aba Captions (reaproveitado o mesmo visual -- anel fino, arco
      superior na cor de destaque, `@keyframes captionsSpin` já
      existente -- só maior e centralizado, com um rótulo "Rendering
      preview…" embaixo, mesmo padrão de acoplar spinner+texto que
      `.captions-step` já usa). Quando o render+poster terminam com
      sucesso, o spinner esconde e o `<canvas>` do mascote assume --
      **o overlay em si (dim+blur) nunca esconde entre as duas fases**,
      só a troca de conteúdo interno, pra não piscar/re-borrar no meio.
      `generateKitPresetPreview` (`client/panel.js`) agora mostra o
      overlay antes do `hostCall` de renderização (não depois);
      `playKitMascotConfirmation` não re-mostra o overlay (só
      defensivamente, caso seja chamada sozinha algum dia) -- só troca
      spinner por canvas. Overlay só esconde de vez: (1) no fim natural
      da animação do mascote (evento real, não timer), ou (2) imediato,
      se o render ou a captura do poster falharem (não tem mascote pra
      mostrar num erro). **Testado ao vivo com um preset real**: logo
      após salvar (antes do `hostCall` resolver), `overlay.hidden:
      false` + `spinnerWrap.hidden: false` + `canvas.hidden: true`
      confirmados -- spinner aparece imediatamente, sem esperar o
      render terminar; depois, tanto a fase do spinner quanto a fase do
      mascote foram capturadas dentro da mesma janela de polling sem o
      overlay nunca ter escondido entre as duas; no final,
      `overlay.hidden: true` de novo.
    - **(b) Toast de erro ficava tempo demais em tela.** Media 7
      segundos (o dobro do toast de sucesso, 4s) -- o usuário mandou
      print mostrando um toast de erro ("Select at least one layer
      first.") ainda visível, achando muito tempo. **Corrigido**
      unificando os dois em 4000ms -- não criou um terceiro valor
      menor pro erro especificamente, só igualou ao que os toasts de
      sucesso já usavam, pra sobrar só uma duração pra lembrar em vez de
      duas. **Testado ao vivo**: disparado um erro real (clicar "Preset
      layers" sem nenhuma camada selecionada -- o mesmo cenário do print
      do usuário) -- toast visível logo após o clique, confirmado
      **escondido** ~4.2s depois (contra os ~7s+ de antes).
47. **Bug real: `captureStyleNode`/`applyStyleLeaf` (host.jsx) tinham um
    `return` logo depois de tratar a expressão de uma propriedade,
    então quando a propriedade tinha KEYFRAMES E expressão ao mesmo
    tempo (padrão real: Position animado por keyframe + expressão de
    terceiros tipo "BOUNCr overSHOOT+" lendo `value` por cima), só a
    expressão era capturada/aplicada -- as keyframes eram descartadas
    silenciosamente. Feedback do usuário com print, frisando que
    "sempre copiar os keyframes de todos as propriedades é importante...
    é oq faz isso ser um preset". **Corrigido** removendo os dois
    `return`s (expressão e keyframes/value não são mais mutuamente
    exclusivas). **Testado ao vivo ponta a ponta** via a ponte de debug
    (comp descartável `MF_TEST_KFEXPR`): capturado e reaplicado um
    Position com 2 keyframes + expressão, valores/tempos das keyframes
    E o texto da expressão batendo 1:1 entre origem e resultado. Ver
    README, "Bug real: keyframes eram descartadas quando a propriedade
    também tinha expressão".
48. **Kit tab ganhou um botão "+" pra criar categorias novas** (pedido
    do usuário com print, círculo embaixo do último item da barra
    lateral). `KIT_CUSTOM_CATEGORIES_KEY` em `localStorage`,
    `getAllKitCategories()` mescla as 4 fixas com as do usuário, usado
    em toda lista de categoria do Kit (barra lateral + seletores de
    Preset layers/Preset comp/Delete/Export). Testado ao vivo: cria,
    persiste, aparece em todo lugar, guarda contra nome duplicado. Ver
    README, "Kit tab: adicionar novos tópicos/categorias".
49. **Botão "Export preset" no footer do Kit**, entre "Preset comp" e
    "Delete preset" (pedido do usuário pra compartilhar presets entre
    membros da produtora). Reaproveita a infra de export de Style
    Presets (`saveTextFileWithNativeDialog`); modo `kitExportMode`
    espelhando `kitDeleteMode`; envelope JSON próprio e versionado
    (`motionFilmKitPresetFile`, `formatVersion: 1`). Só presets custom
    são exportáveis. **Sem Import correspondente ainda** -- não
    construído preventivamente, mencionado ao usuário. Ver README,
    "Kit tab: botão 'Export preset'".
50. **Bug real: renderizar a prévia de um preset do Kit travava o painel
    inteiro** -- descoberto ao vivo (engine ExtendScript parou de
    responder até uma chamada `pong` trivial, timeout em 8s e depois em
    25s) durante o teste do item 47. Causa (explicada pelo usuário):
    após o render pela Render Queue, o AE mostra uma janela nativa
    perguntando se o arquivo renderizado foi "anexado" ao projeto,
    exigindo OK manual -- e como o engine é single-thread, isso bloqueia
    QUALQUER `evalScript` seguinte até alguém clicar. Causa técnica: o
    Output Module herdava `Post-Render Action: Import` do template
    aplicado. **Corrigido** forçando `om.postRenderAction =
    PostRenderAction.NONE` logo após `applyTemplate(...)`, dentro de um
    `try/catch`. Testado ao vivo com cuidado (chamadas isoladas, sem
    sobrepor `evalScript`s): render disparado direto (kind `"layers"`,
    autocontido) terminou `{"ok":true}`, e um `pong` imediatamente
    depois respondeu sem travar e sem nenhuma janela aparecendo. Ver
    README, "Bug real: render da prévia do Kit travava o painel
    inteiro".
51. **Footer do Kit (Preset layers/comp, Export/Delete preset) virou
    ícone-only, com tooltip customizado (não o `title` nativo) que só
    aparece depois de 1s parado em cima do botão** -- pedido do usuário
    com print, 4 botões com texto ficavam espremidos lado a lado.
    `initFooterTooltips()` novo e genérico em `panel.js` (qualquer
    `[data-tooltip]` ganha o comportamento, não só os 4 do Kit); texto
    de cada botão migrou de `title` pra `data-tooltip`, mesmo conteúdo.
    Testado ao vivo via mouseenter/mouseleave sintéticos: escondido aos
    300ms, visível aos 1200ms, texto correto, escondendo na hora ao sair
    do botão. Ver README, "Kit tab: footer só com ícones + tooltip
    customizado com atraso de 1s".
52. **Botão "Import preset" no footer do Kit** (contraponto do Export do
    item 49) **+ tooltips dos 5 botões reduzidos a só o nome da ação**
    (o texto técnico detalhado que virou tooltip no item 51 ainda era
    longo demais pro usuário). Import reaproveita o padrão de `<input
    type="file" hidden>` + `FileReader` já usado pelo import de Style
    Presets -- sem diálogo nativo próprio, sem risco de travar numa
    janela do SO. Aceita o envelope do Export e formatos mais soltos;
    cria categoria nova se precisar; dispara `generateKitPresetPreview`
    pra já chegar com vídeo real. Testado ao vivo com um `File`
    construído em memória (contorna o diálogo nativo de abrir arquivo):
    preset importado corretamente, render disparado e terminado
    **sem travar** (reconfirma o fix do item 50 através do fluxo real da
    UI), `pong` depois respondeu na hora. Tooltips confirmados curtos
    ("Create Layer Preset", "Create Comp Preset", "Export Preset",
    "Import Preset", "Delete Preset"). Artefatos de teste limpos depois.
    Ver README, "Kit tab: botão 'Import preset' + descrições dos botões
    bem mais curtas".
53. **Apagar um tópico inteiro do Kit: Shift+click no nome do tópico,
    dentro do mesmo seletor que "Delete preset" já abria** -- ideia
    dada pronta pelo usuário (mesmo botão, clique normal continua
    armando apagar-preset como sempre, Shift+click no NOME do tópico
    apaga o tópico). `buildChoicePicker` passou a repassar o
    `MouseEvent` pro `onPick` (Save/Export ignoram o segundo argumento,
    só Delete lê `shiftKey`); `deleteKitCategory()` novo recusa tópico
    embutido, senão remove o tópico + todo preset custom nele (com
    limpeza de arquivo de prévia via `deleteKitPreviewFiles`, igual
    apagar um preset avulso já faz) + volta `kitState.category` pro
    primeiro tópico embutido se era o selecionado. Testado ao vivo com
    `MouseEvent` sintético (`shiftKey: true`): tópico embutido recusado,
    clique normal sem regressão, Shift+click num tópico custom apagou
    ele e o preset dentro, mensagem e estado final conferidos. Ver
    README, "Kit tab: apagar um tópico inteiro (Shift+click no seletor
    do 'Delete preset')".
54. **Os 4 tópicos originais do Kit também viraram apagáveis** (pedido
    de acompanhamento do item 53 -- "torne qualquer topico deletavel,
    inclusive os que criamos inicialmente"). `KIT_CATEGORIES` continua
    uma constante fixa (nunca mutada); `motionfilm-kit-deleted-builtin-
    categories` novo no `localStorage` guarda só os nomes dos originais
    apagados, `getAllKitCategories()` filtra contra essa lista antes de
    somar os custom. Dois lugares que assumiam "Text reveal sempre
    existe" (`kitState` inicial, fallback de categoria no Import)
    passaram a usar `getAllKitCategories()[0]` em vez do
    `KIT_CATEGORIES[0]` fixo. Sem piso mínimo -- dá pra apagar os 4.
    Testado ao vivo: "Effects" apagado via Shift+click, some da barra na
    hora, persiste depois de um reload de verdade, preset real do
    usuário intacto; restaurado depois, os 4 originais confirmados de
    volta. Ver README, "Kit tab: agora QUALQUER tópico é apagável,
    inclusive os 4 originais".
55. **Toast de status: 4s → 2s** -- segundo pedido de redução (já tinha
    ido de 7s pra 4s antes nesta sessão), usuário ainda achou devagar.
    Testado ao vivo com `performance.now()`: visível aos 1000ms/1800ms,
    escondido aos 2300ms, batendo com ~2s. **Efeito colateral notado
    durante esse teste** (não do fix em si): várias recargas via CDP em
    sequência numa sessão de teste longa deixaram o
    `motionfilm-kit-deleted-builtin-categories` com 3 tópicos marcados
    como apagados sem eu ter pedido isso, e uma categoria custom
    "Shapes" duplicada -- provável zumbi de contexto JS antigo (mesma
    limitação do item 30) escrevendo no `localStorage` compartilhado.
    Corrigido na hora, nenhum dado do usuário (preset real) foi
    afetado. Lição: preferir fechar/reabrir o painel de dentro do AE em
    vez de mais uma recarga via CDP quando o estado parecer
    inconsistente numa sessão de teste longa. Ver README, "Duração do
    toast de status: 4s → 2s".
56. **Bug real de performance: `forEachKeyedPropertyAnyLayer` (aba
    Curves -- Apply Velocity/Reverse/Reposition/Copy-Paste Keyframe
    Curves) fazia um walk RECURSIVO de toda a árvore de propriedades de
    TODA camada da composição** só pra achar qual propriedade tinha
    keyframes selecionados -- necessário considerar toda camada mesmo
    (box-select cruza trilhas sem selecionar a linha da camada), mas o
    COMO estava caro: cada `.value`/`.numKeys`/`.keySelected()` cruza a
    ponte ExtendScript-AE, custo fixo alto por chamada, multiplicado
    pela contagem total de propriedades da comp inteira. Usuário notou
    certo: Apply Velocity ficava mais lento quanto mais camadas a comp
    tinha, mesmo selecionando só uma. **Corrigido** trocando pra
    `layer.selectedProperties` (a lista que o próprio AE já mantém de
    propriedades destacadas no Timeline) -- uma chamada barata por
    camada em vez do walk completo. `repositionSelectedKeyframes`,
    `copySelectedKeyframeCurves`, `pasteSelectedKeyframeCurves` tinham
    cópias manuais do mesmo walk caro, todas convergidas pro mesmo
    helper corrigido. **Testado ao vivo com números reais** (250
    camadas Solid+Drop Shadow, só 1 com keyframes selecionadas): walk
    antigo 2224ms → novo 3ms (~740x), chamada real de ponta a ponta
    (`applyVelocityProfile`) 6ms com resultado correto
    (`changed:3, skipped:0`). Artefatos de teste (250 items "PerfLayer*"
    órfãos que `comp.remove()` sozinho não limpa -- `addSolid` cria um
    item de projeto à parte) limpos depois, confirmado 0 sobrando. Ver
    README, "Bug real de performance: ferramentas de keyframe (aba
    Curves) escaneavam a composição inteira".
57. **Bug real: prévia em vídeo do Kit travava depois de hover rápido
    demais** -- `video.play()` é assíncrono, `video.pause()` não; o
    tile chamava os dois direto no `mouseenter`/`mouseleave` sem
    considerar se o `play()` anterior ainda estava em voo, e passar o
    mouse rápido o bastante deixava o `<video>` preso, sem tocar mais
    em hovers seguintes. **Corrigido** com duas flags (`wantsPlaying`,
    `playRequestPending`): só um `play()` em voo por vez, `pause()`
    nunca roda em cima de um ainda não resolvido -- se o mouse sai
    antes dele resolver, só marca a intenção e deixa o próprio
    `.then()`/`.catch()` reconciliar. Testado ao vivo: rajada de 13
    entradas/saídas sem espera nenhuma (pior caso), depois um hover de
    verdade -- vídeo confirmado tocando de novo, `currentTime`
    avançando normalmente. Ver README, "Bug real: prévia em vídeo do
    Kit travava depois de passar o mouse rápido demais".
58. **O bug do cursor de texto pulando pra trás voltou -- causa raiz
    era `refreshShape()` (aba Shape), que a correção "tentativa 3"
    (item 30 acima) nunca cobriu.** `refreshShape` chamava
    `hostCall("readShapeLayer", ...)` em TODO tick de 700ms, sem gate
    nenhum -- `readShapeLayerInner` (host.jsx) só desiste de verdade
    (`isShape: false`) DEPOIS de já ter rodado `activeComp()`/
    `selectedLayers()`/`isShapeLayer()` no motor do AE, então mesmo com
    uma camada de texto selecionada essa chamada continuava tocando o
    engine a cada 700ms -- exatamente a mesma classe de colisão com
    edição de texto no viewport que `readLayerTransform` tinha (só que
    aquele já tinha sido corrigido, esse nunca foi). **Corrigido**
    aplicando o MESMO throttle (`likelyEditingText` +
    `TRANSFORM_TEXT_POLL_DIVISOR`, `shapeState.skipCounter` novo) já
    usado em `refreshTransform`. Tentei confirmar ao vivo contando
    chamadas via `window.__adobe_cep__.evalScript` instrumentado, mas
    esbarrei no item 30b (zumbis de reloads anteriores + cache do
    `panel.js` contaminando a contagem) -- não consegui um número limpo
    dessa vez, mas o mecanismo é idêntico, char por char na condição,
    ao que já está comprovadamente funcionando pro Transform. Pedido ao
    usuário pra fechar/reabrir o painel de dentro do AE antes de testar
    (mesmo motivo do item 30) e confirmar na prática. Ver README, "Bug
    real: `refreshShape` nunca ganhou o throttle de edição de texto".
59. **Aba Captions: seção Transcription virou botões lado a lado com
    ícone (Transcribe/Import SRT), parágrafos de explicação longos
    viraram tooltip (`data-tooltip`, mesmo `initFooterTooltips()` do
    Kit -- reaproveitado como está, não é código novo); seção Style
    ganhou ícones nos 2 botões existentes + um botão novo, "Change
    Style"**, terceiro na mesma fileira. Change Style resolve trocar a
    animação/estilo de camadas de legenda JÁ geradas ou importadas sem
    reescrever o texto nem retranscrever o vídeo -- abre o mesmo tipo
    de seletor do Export/Delete do Kit com os Style Presets salvos;
    escolher um chama `applyStylePresetToSelectedLayers` (host.jsx,
    novo), que primeiro `clearLayerStyleAnimation` (remove todo Effect
    Parade, todo Text Animator, limpa expressão+keyframes do Transform
    Group, Source Text intocado) e só depois reaplica
    `applyStylePresetToLayer` (a mesma função já usada na criação de
    legenda/Kit preset -- mesmo re-anchoring de timing contra o
    `inPoint` da própria camada). Testado ao vivo ponta a ponta contra
    um Style Preset real do usuário ("tste 3"): efeito antigo (Drop
    Shadow) confirmado removido, keyframes antigas de Position
    confirmadas removidas, efeito+animador do preset novo confirmados
    presentes -- troca completa, nada da aparência antiga sobrou.
    Tooltip do Transcribe também testado (dwell 1s, texto certo). Ver
    README, "Aba Captions: botões lado a lado com ícones + descrições
    viraram tooltip + botão 'Change Style'".
60. **Kit "Preset layers" agora salva QUALQUER camada literalmente, não
    só texto** (bug reportado: preset de shape gerava camada de texto).
    `createLayerFromKitTemplate` (host.jsx) reescrita com `switch` por
    `kitLayerType()` (text/shape/solid/null/adjustment/camera/light; `av`
    = footage/precomp é pulado com aviso -- Fase 2). Captura completa via
    a `captureStyleNode` genérica: Contents de shape, máscaras, transform
    inteiro, material/geometry options 3D, time remap, flags da camada.
    `kitShapeSafe`/`reviveShapeValue` (topo do host.jsx) achatam/
    reconstroem `Shape` (não sobrevive JSON) -- chamados de dentro de
    `captureStyleNode`/`applyStyleLeaf`, aditivo e no-op pra valores não-
    Shape (Style Presets text-only intocados, confirmado sem regressão).
    `applyKitLayerGroupList` cria em ordem REVERSA (preserva empilhamento)
    + 2ª passada de reparent/track-matte. **`captureLayerStyleParts` e
    `applyStylePresetToLayer` NÃO foram tocados** -- são o caminho dos
    Style Presets da aba Captions. **Falta terminar**: Layer Styles não
    transferem (o grupo `ADBE Layer Styles` rejeita `addProperty`
    genérico -- precisa de force-add especial tipo o dos text animators).
    Testado ao vivo: 7 tipos de camada recriados corretamente, com
    keyframes/parent/blend/3D/máscara/Contents. Ver README, "Kit 'Preset
    layers': salva QUALQUER camada".
61. **Kit preset: footage baseado em arquivo (SVG/imagem/vídeo/áudio) +
    export empacotado.** `captureSingleLayerTemplate` grava
    `avSource:{kind:"file",originalPath,...}`; `panel.js`
    `copyKitPresetAssets` copia o arquivo pra
    `client/assets/kit-assets/<presetId>/` ao salvar; aplicar reimporta
    (`kitImportOrReuseFootage` no host, `av.absPath || av.originalPath`
    como fallback pra presets salvos antes da cópia). **Export**: preset
    com footage vira `.zip` (STORE escrito à mão em `panel.js`:
    `mfZipStore`/`mfZipRead`/`mfCrc32` -- sem lib, CSP), com
    `preset.json`+`preview.*`+`assets/*`; sem footage continua `.json`.
    **Import** lê `ArrayBuffer`, detecta zip por magic `PK\x03\x04`,
    desempacota e gera id novo. `saveBinaryFileWithNativeDialog` usa
    Node `fs.writeFileSync` (o `cep.fs.writeFile` é só texto). **Não
    coberto**: pré-composições (comp interna, precisa recursão). Ver
    README, "Kit preset: footage baseado em arquivo" e "export/import de
    footage empacotado".

62. **"Undo group mismatch" depois de salvar qualquer preset de Kit.**
    `renderKitPreviewClip` (host.jsx) chamava
    `app.project.renderQueue.render()` dentro de um
    `app.beginUndoGroup()`/`app.endUndoGroup()`. O `render()` gerencia a
    própria pilha de undo do AE; embrulhá-lo num grupo de script deixa a
    contagem push/pop desbalanceada e o AE reclama ("will attempt to
    fix") na PRÓXIMA edição naquela camada. **Correção**: monta a comp
    descartável + item da fila dentro do grupo `"Mótion Film: Render Kit
    preview"`, **fecha o grupo com `app.endUndoGroup()` ANTES** do
    `render()`, roda `render()` **fora de qualquer grupo**, e faz a
    limpeza (`rqItem.remove()`+`tempComp.remove()`) num segundo grupo
    curto `cleanupPreview()`. **Lição: nunca embrulhar
    `renderQueue.render()` em `beginUndoGroup`/`endUndoGroup`.** Exige
    reiniciar o AE (host.jsx mudou) pra sumir o aviso.

63. **"One footage file was saved as missing" depois da prévia de um
    preset com footage.** O render da prévia importa o arquivo de footage
    no projeto pra montar a comp descartável; ao apagar a comp, o item
    ficava órfão e o AE avisava no save seguinte se o arquivo-fonte
    tivesse mudado de lugar. **Correção**: `renderKitPreviewClip` tira um
    snapshot dos `id`s de item antes de montar a comp e, no
    `cleanupPreview()`, remove todo `FootageItem` fora do snapshot com
    `usedIn.length === 0`. Órfãos anteriores à correção: limpar 1x à mão
    (File → Dependencies → Remove Unused Footage). Ver README.

64. **Kit "Preset layers" agora salva pré-composições inteiras, não só
    pula elas.** Antes, uma camada de pré-comp na seleção era descartada
    silenciosamente (`kitAvSourceInfo` só reconhecia footage de arquivo).
    `captureSingleLayerTemplate` agora detecta `layer.source instanceof
    CompItem` e chama `captureKitCompFull`, que captura TODA a
    sub-composição recursivamente (cada camada dela via a mesma função --
    pré-comp dentro de pré-comp funciona até `KIT_MAX_COMP_DEPTH = 8`).
    Precisou de um parâmetro novo em `buildKitLayerTemplates`
    (`keepAbsoluteTime`) porque camadas DENTRO de uma comp precisam manter
    posição absoluta (relativa ao frame 0 daquela comp), diferente do
    grupo de topo (que normaliza pro playhead). Na aplicação,
    `createKitCompFromTemplate` cria uma `CompItem` nova e a popula
    reusando `applyKitLayerGroupList` -- recursivo por construção.
    `panel.js` ganhou `walkKitAvSources` pra andar essa árvore em
    qualquer profundidade (cópia/resolução de footage aninhado, contagem
    de "tem assets", limpeza de import). O reaper de órfãos do preview
    (item 63) também passou a cobrir `CompItem`, em loop até estabilizar
    (uma pré-comp aninhada só fica "sem uso" depois que o pai é removido).
    Testado ao vivo: offset absoluto, dimensões/duração da comp recriada,
    contagem de camadas e ausência de "Undo group mismatch" -- tudo
    confirmado via a ponte de debug. Ver README.

65. **`comp.selectedLayers` devolve a ordem de SELEÇÃO (clique), não a
    ordem de empilhamento do Timeline.** Bug real, confirmado ao vivo:
    numa comp com "Texto" em `layer(1)` e "pre-comp" em `layer(2)`,
    selecionar "pre-comp" antes de "Texto" (shift-clique de baixo pra
    cima) fez `comp.selectedLayers` devolver `[pre-comp, Texto]` --
    invertido. Isso sempre afetou `captureKitLayerGroupFromSelection`
    (Kit "Preset layers", desde que a feature existe), não só a captura
    de pré-comps nova (item 64) -- só ficou visível agora porque o teste
    envolveu selecionar 2 camadas de uma vez. Consequência em cadeia:
    como a ordem capturada fica errada, a 2ª passada de Track Matte em
    `applyKitLayerGroupList` (que assume `layersList[j-1]` = "o layer
    logo acima de `layersList[j]` na ordem real") liga o matte no layer
    errado. **Lição: nunca usar `comp.selectedLayers` como se already
    viesse em ordem de stacking -- sempre ordenar por `layer.index`
    antes de qualquer lógica que dependa de adjacência/ordem.**
    Correção: `captureKitLayerGroupFromSelection` agora faz
    `layers.slice().sort(function(a,b){return a.index - b.index;})`
    logo após pegar a seleção. `captureKitCompFull` (varre por
    `compItem.layer(i)`, não por seleção) nunca teve esse problema.
    Presets já salvos com a ordem errada precisam ser refeitos -- a
    correção só vale pra capturas novas. Ver README.

66. **Cursor de texto pulando pro início -- 4ª volta. Poll consolidado.**
    Itens 28/29/58 foram afinando leituras individuais do poll de 700ms
    mas nunca mataram o bug: `readLayerTransform` (varredura de transform
    completa) + `readShapeLayer` (`.property()` na camada de texto ativa)
    continuavam a ~2.8s mesmo com o throttle "1 em 4", e
    `refreshEffectsManager` rodava a cada 700ms **sem throttle nenhum**
    com a aba Effects aberta. **Correção estrutural**: `pollTick`
    (panel.js) substitui as 4 chamadas soltas do `setInterval`. Todo
    tick faz UMA chamada barata nova, `getSelectionSummary()` (host.jsx)
    -- só `activeItem` é comp? / nº de selecionadas / `.index` da 1ª /
    `instanceof TextLayer`. Nada de `.name`/`.value`/`.property()`. Só
    escala pras leituras pesadas quando a seleção mudou OU não é texto.
    Com a MESMA camada de texto selecionada e `textState.doc` carregado
    (= quase certeza que está digitando no viewport), pula TODAS as
    leituras pesadas -- zero, não "1 em N". `forceFullRefresh()` num
    `window` `"focus"` / `document` `"mouseenter"` (debounce 400ms) põe
    tudo em dia quando o usuário volta pro painel. **Lição: em vez de
    caçar campo por campo, consolidar o poll num único probe mínimo e
    só escalar sob demanda.** Trade-off: painel Transform não atualiza
    sozinho com camada de texto selecionada (volta a atualizar no
    mouseenter/focus/troca de seleção). `getSelectionSummary` testado ao
    vivo; o "parou de pular?" precisa de digitação real -- pedido ao
    usuário pra fechar/reabrir o painel e confirmar. Ver README.

67. **A Render Queue não grava em pasta com acento.** `om.file = new
    File("C:/Users/Usuário/Documents/Mótion Film Tools/...")` + `rq.render()`
    falhou com "Can not create a file in directory C:\Users" (confirmado
    ao vivo, aba Captions). Passar o caminho curto 8.3 (`toShortPath`,
    só ASCII) resolveu. **Lição: todo caminho que o AE vai RENDERIZAR
    (não só os que vão pro whisper-cli) vai em 8.3 no Windows.** Também:
    num teste via CDP, um `evalScript` com erro de sintaxe abre um
    diálogo modal "Unable to execute script at line 1" NO AE DO USUÁRIO
    (um por chamada) -- uma quebra de linha real (`\r` sem escapar)
    dentro de uma regex no código mandado foi o culpado. Testar o
    snippet antes de mandar em loop.

68. **Teste ao vivo no AE do usuário cria coisas NO PROJETO DELE.** O
    projeto aberto era o do usuário (ele importou o vídeo dele no mesmo
    projeto sem salvar): comps/áudios de teste, sólidos "MF Captions
    shade" e "Null N" de cada teste ficaram lá, e um teste de geração
    criou legendas na comp DELE (ele trocou de comp no meio). **Lição:**
    (a) a criação tem que mirar a comp de origem por id, nunca a ativa;
    (b) depois de cada teste, limpar também os itens de sólido/null que
    o teste criou (`usedIn.length === 0`) e reabrir a comp que estava
    ativa; (c) com o usuário mexendo no AE, avisar antes de testar.

## Jeito de trabalhar que funcionou bem

- **Testar de verdade em vez de só ler o código**, sempre que possível: para
  mudanças em `client/` (HTML/CSS/JS), eu subo um servidor HTTP local
  (PowerShell `HttpListener`, porta 8743, servindo a pasta `client/`) e abro
  no navegador da ferramenta (Claude Browser), inclusive verificando estado
  via JavaScript direto (cliques simulados, checagem de classes/estilos
  computados) quando o screenshot visual não carrega. Isso pegou bugs reais
  antes de chegar no usuário.
- **Quando um bug se recusa a ser corrigido "no escuro"** (2+ tentativas
  falhas sem dado concreto), o caminho certo é adicionar diagnóstico real
  (contadores, valores exatos) que aparece pro usuário, em vez de continuar
  chutando. Foi assim que os bugs 1, 3 e 5 acima foram finalmente achados.
- **Match names do After Effects** (tipo `ADBE Text Animator`, `ADBE Slider
  Control` etc.) são conferidos contra a documentação oficial de scripting
  e exemplos reais da comunidade antes de escrever código -- e agora,
  quando possível, também validados de verdade contra o AE aberto via a
  ponte de debug (ver seção acima) antes de considerar a mudança pronta,
  em vez de só "no chute".
- Quando um bug se recusa a fazer sentido depois de eliminar as causas
  óbvias (cache, digitação errada), vale considerar que a ferramenta de
  investigação em si pode ser a culpada (como os itens 9 e 10 da lista
  acima) -- isolar com testes cada vez menores até achar o ponto exato
  onde o comportamento muda, em vez de insistir na mesma hipótese.
- Peço confirmação do usuário antes de decisões de design genuinamente
  ambíguas (via pergunta de múltipla escolha), mas ajo direto em decisões
  técnicas onde há uma resposta objetivamente certa.

## Estado atual do projeto

- **Aba Home**: tudo que já existia -- Curves (curva de velocidade +
  utilitários de keyframe), Text (propriedades de texto), Layer Transform,
  Shape Contents, Shape Properties. Cada seção tem visual de "pasta" simples
  (aba arredondada + corpo), clicável pra recolher/expandir, estado salvo em
  `localStorage`.
- **Aba Text** (v4): ferramenta de "Character Reveal" -- 4 botões (Add/
  Copy/Paste/Remove) que criam/copiam/removem uma animação de texto por
  caractere usando só API nativa do AE (Text Animator + Expressible
  Selector, sem efeito/plugin de terceiros). Todos os parâmetros existem
  como Slider Controls nativos no Effect Controls do AE, numa lista
  plana sem divisores (guiados por expressão, não por keyframes fixos)
  -- `Duration`, `Direction` (1-6, ver README), `From Index`,
  `Random Seed`, `Position Offset`, `Scale Start`, `Rotation Start`. O
  painel expõe só um seletor de Direction por clique (sincronizado ao
  vivo com o slider real no Effect Controls) -- os campos numéricos NÃO
  ficam duplicados no painel (tentativa de v3, revertida a pedido do
  usuário: ficava redundante/confuso ter os mesmos sliders em dois
  lugares). Também foi tentado (e revertido) usar `ADBE Checkbox
  Control` renomeado como divisor visual de texto no Effect Controls --
  tecnicamente funciona, mas cada divisor aparece como sua própria linha
  `fx` com "Reset" e ícone de checkbox, então virou mais títulos grandes
  em vez de organização discreta. Seção dobrável nativa continua
  confirmada impossível via script (lição 16) -- não existe forma de
  agrupar visualmente os sliders no Effect Controls além da lista plana.
  Mecânica completa, as duas tentativas e os motivos de cada reversão
  estão documentados no README (múltiplas seções de changelog seguidas,
  a partir de "Character Reveal: modos de direção + canais extras") --
  inclui achados de uma inspeção ao vivo (via a ponte de debug) de como
  o TextEvo2 (script de terceiros) monta a animação dele mesmo, só pra
  entender a arquitetura geral, sem copiar código/painel deles.
- **Aba Curves** (dentro de Home): barra de ações agora tem Apply Curve,
  Reposition, Copy Keyframe Curves, Paste Keyframe Curves (Reverse e Reset
  foram removidos da UI, a lógica de host continua existindo caso volte a
  ser útil).
- **Barra de status**: virou um toast temporário (`#status`), some sozinho
  depois de alguns segundos, no lugar de ocupar espaço fixo o tempo todo.
- **Aba Kit**: lista de categorias (Text reveal/Shapes/Composition/Effects)
  à esquerda, com divisória arrastável (`#kit-resizer`, largura salva em
  `localStorage`), e grade de telinhas com preview animado em CSS à
  direita. Só um preset implementado até agora ("Fade In", categoria Text
  reveal) -- `KIT_PRESET_HANDLERS` no host.jsx é o ponto certo pra
  adicionar os próximos.
- **Aba Icons**: busca (com debounce) e importação de ícones SVG de
  licença aberta via API pública da Iconify (`api.iconify.design`, sem
  chave), direto pro projeto do AE como footage comum (não Shape Layer
  editável). Precisa de internet -- decisão explícita do usuário, ciente
  da dependência. Ver lição 17 acima sobre o bug de `:` no nome do arquivo
  (já corrigido) e o README (seção "aba 'Icons'") pros detalhes completos.
  Também já foram corrigidos dois bugs reais a mais: (1) o SVG baixado
  pra importação vinha com `fill="currentColor"` (proposital, pra não
  travar na cor do painel), mas o importador de SVG do AE não resolve
  `currentColor` pra nenhuma cor -- o ícone importava com bounding box
  certo mas nenhum pixel visível em nenhuma escala. Corrigido buscando o
  SVG já com `?color=%23ffffff` (branco) embutido, igual o preview já
  fazia. (2) o SVG da Iconify também vem com `width="1em" height="1em"`
  por padrão -- unidade que não resolve fora de um contexto CSS de
  verdade, e o AE lê isso como fonte de 1x1px (confirmado ao vivo numa
  camada real do usuário, precisando de ~471740% de escala manual pra
  compensar). Corrigido acrescentando `&height=512` na mesma URL --
  a Iconify aceita esse parâmetro e grava um número fixo no lugar de
  `1em` sem alterar o `viewBox`/paths (continua vetor, sem perda de
  qualidade). (3) mesmo depois de (1) e (2), a camada perdia qualidade
  ao escalar -- faltava ligar `layer.collapseTransformation = true`
  ("Continuously Rasterize") na camada recém-criada; sem isso o AE
  rasteriza a arte vetorial uma vez, no tamanho de importação, e só
  estica esse raster fixo depois, igual uma imagem comum. Corrigido em
  `importSvgIcon` logo após `comp.layers.add(...)`. (4) a pedido do
  usuário, todo ícone importado agora vai pra dentro de uma pasta única
  do painel Project chamada "Motion_Film_Icons"
  (`findOrCreateIconsProjectFolder()`, criada só no primeiro import e
  reaproveitada depois) -- só organização dentro do `.aep`, sem relação
  com a pasta `Documents/Mótion Film Icons` no disco (essa continua
  guardando os `.svg` de origem). (5) usuário pediu mais variedade de
  fontes de ícone -- pesquisei Openclipart (API pública fora do ar,
  descartado) e The Noun Project (mudou pra teste de 30 dias + planos
  pagos depois, descartado por não bater com "sem limite nenhum" que o
  usuário pediu). Em vez disso, `ICON_SEARCH_FALLBACK_TERMS` em
  `client/panel.js` cobre 11 palavras de profissão comuns que davam zero
  resultado no Iconify (attorney, physician, professor etc.) mas cujo
  conceito já existe lá sob outro nome (law, doctor, teacher etc.) --
  substitui automaticamente com aviso visível na grade, nunca em
  silêncio. (6) a busca de ícones tinha `&limit=64` fixo e nunca pedia
  mais -- por isso a grade sempre "parecia" ter a mesma quantidade
  (quase toda palavra tem >64 resultados reais) e não sobrava nada pra
  rolar. Tentei corrigir com paginação via `&start=N`, mas descobri ao
  vivo que o campo `total` do Iconify **não é estável** (muda conforme o
  `limit` pedido -- a API para de contar assim que atinge esse limite).
  Correção final: uma única busca por termo com `&limit=999` (teto real
  do Iconify), guarda a lista completa em memória e revela 64 por vez
  conforme rola (`ICONS_PAGE_SIZE`/`iconsSearchState` em `client/
  panel.js`) -- sem chamada de rede nova a cada página.
- **Aba Captions, fase 1 da versão própria das legendas dinâmicas
  (2026-10-21)**: o áudio agora é renderizado pelo próprio AE (Render
  Queue, template "AIFF 48kHz") -- camada selecionada (copiada sozinha
  numa comp temporária) ou, sem seleção, a comp inteira na work area;
  whisper roda com `-dtw <modelo> -nfa` (tempo por palavra); o novo
  `client/captions-core.js` (JS puro, testável no Node) alinha palavras
  à energia do áudio, joga fora frases inventadas e agrupa as legendas
  por programação dinâmica. Base: `ANALISE-AFTERFLIX-CAPTIONS.md` na
  raiz (engenharia reversa do AfterFlix Captions -- reimplementar
  ideias, nunca copiar arquivos deles). **Fase 2 (mesmo dia)**: aba
  refeita como guia 1 Style / 2 Animation / 3 Highlight / 4 Adjust
  (`client/captions.js`), botões antigos e Style Presets removidos,
  motor novo `createCaptionSet` (modelo + copyToComp, marcador por
  palavra + Expression Selectors, 13 animações, destaque da palavra
  falada, caixa, sombra de fundo). Depois (mesmo dia): **estilos Reels/Viral**
  (13, `captions-styles.js`), layout compartilhado painel/AE
  (`captions-layout.js`, ES3), planejador da palavra destaque
  (`planHighlights`), motor `createViralSet` (Null + uma camada por
  linha), 4 animações novas, aba Destaque, fontes OFL em
  `motion-film/fonts/` instaladas pelo painel só pro usuário. Próximo:
  registro no XMP + editor de texto. Ver README "Captions fase 1",
  "fase 2" e "estilos Reels e Viral".
- **Aba Captions**: transcreve o áudio da camada selecionada e cria uma
  camada de texto por frase, posicionada no tempo certo -- **100% local**
  (whisper.cpp + ffmpeg via `child_process` do Node, já habilitado nesta
  extensão), sem conta, sem chave, sem custo, sem limite. Setup de
  primeira vez baixa ~620MB (motor de transcrição + conversor de áudio +
  modelo de linguagem "small") pra `Documents/Mótion Film Tools/`. Ver
  lições 18-20 acima (bridge `cep_node.require`, `spawn`+`exit` em vez de
  `execFile`, nome curto 8.3 pro bug de acento do whisper-cli.exe) e o
  README (seção "aba 'Captions'") pros detalhes completos, incluindo a
  pesquisa de por que não usar uma API de nuvem paga. Depois do primeiro
  teste do usuário, três ajustes: (a) a transcrição agora respeita o
  corte In/Out da camada na timeline em vez de sempre ler o arquivo de
  origem inteiro (`-ss`/`-to` no ffmpeg, calculados em
  `getSelectedLayerAudioInfo`); (b) o texto de status das etapas ganhou
  uma classe própria (`.captions-step-text`) com a cor de destaque do
  tema e fonte maior, em vez de dividir estilo com os parágrafos de
  instrução estáticos; (c) um spinner giratório em CSS puro
  (`.captions-spinner`) ao lado do texto de status. Depois desses três,
  mais um pedido: (d) clicar em "Transcribe" agora abre um modal (fundo
  do painel escurecido/borrado, primeira vez que esse padrão visual
  aparece na extensão) com comprimento de legenda (1 linha/2 linhas/
  palavra por palavra), limite de caracteres, presets salváveis, e
  idioma (99 idiomas do Whisper, com busca). Ver lição 21 acima
  (`window.prompt` trava a thread inteira -- nunca usar diálogos nativos
  aqui) e o README (seção "modal de configurações da legenda") pros
  detalhes completos do algoritmo de agrupamento por modo. Depois disso,
  dois refinamentos a mais: (e) corrigido bug real de empacotamento --
  o agrupador cortava por token bruto do whisper (que frequentemente
  quebra uma palavra em pedaços de subpalavra) em vez de palavra inteira,
  então uma legenda podia cortar uma palavra ao meio; e no modo "2
  Lines", só a primeira linha era checada contra o limite de caracteres,
  a segunda recebia "o que sobrasse" sem limite nenhum. Reescrito pra
  juntar tokens em palavras primeiro (`flattenWhisperWords`) e preencher
  linha por linha com cada linha checada individualmente. (f) **Style
  Presets** -- botão "Save Style Preset From Selected Layer" que captura
  recursivamente todo efeito/Text Animator/propriedade animada de
  Transform de uma camada de texto já estilizada à mão
  (`captureLayerStylePreset` em host.jsx, caminhada genérica baseada no
  fato de que `PropertyGroup.addProperty()` funciona igual em qualquer
  grupo indexado do AE -- Effect Parade, lista de Animators, etc.), e um
  seletor "Style Preset" no modal que reaplica esse preset em cada
  legenda criada, com os keyframes deslocados no tempo pra caírem sempre
  no início de CADA camada (`timeOffset = novaCamada.inPoint -
  preset.layerInPoint`), não num ponto fixo. Testado ao vivo com fade-in
  de opacidade + Drop Shadow -- confirmado nas 4 legendas criadas, cada
  uma com o efeito e as mesmas keyframes relativas ao próprio início.
  (g) usuário testou com um efeito de terceiros de verdade (TextEvo2) e
  ele veio como "Unknown Effect" ao colar -- causa real: um Pseudo Effect
  (`Pseudo/textevo`) não carrega nome de exibição próprio, e nosso
  capturador não salvava/reaplicava `.name` pra nenhum efeito. Corrigido
  capturando/reaplicando `.name` pra todo filho de grupo indexado.
  Confirmado ao vivo: precisa que quem for aplicar o preset **também
  tenha o plugin de terceiros instalado** (aceito pelo usuário -- a ideia
  nunca foi clonar o efeito proprietário, só referenciar um plugin de
  verdade já instalado, do mesmo jeito que copiar/colar uma camada entre
  projetos já faz nativamente no AE).
  (h) botão de salvar preset virou dois botões iguais lado a lado
  ("Save Style Preset"/"Manage Presets"); o segundo abre um modal com
  lista de todo preset salvo, cada um com Edit (renomear na hora, sem
  diálogo nativo) e Delete. (i) a pedido do usuário, o preset agora
  também captura fonte/tamanho/cor/justificação do texto
  (`captureTextDocumentStyle`, lista de campos conferida contra a
  documentação oficial do `TextDocument` -- nunca `.text`, cada legenda
  mantém seu próprio texto transcrito) e a Position/Anchor Point da
  camada **sempre**, mesmo sem keyframe (antes só capturava se fosse
  animado) -- útil pra manter o mesmo posicionamento de legenda em
  vídeos diferentes. Testado ao vivo com fontSize/cor/posição custom --
  as 3 legendas criadas vieram todas idênticas, nenhuma no
  posicionamento padrão.
  (j) usuário reportou que, mesmo colando sem erro de expressão e com as
  keyframes presentes, "a animação do texto não acontece" -- bug real
  encontrado por bisecção ao vivo (ver item 22 da lista de erros acima):
  `ADBE Text Animator Properties`/`ADBE Text Selectors` reportam
  `propertyType` de grupo nomeado, mas exigem `addProperty()` (não
  `.property()`) pra habilitar um canal novo, ao contrário de todo outro
  grupo nomeado do AE. A aplicação genérica usava `.property()` nesse
  caso, o que devolvia uma propriedade sem `canSetExpression`,
  descartando silenciosamente a expressão -- exatamente o que faz
  efeitos tipo TextEvo2 se mexerem (os keyframes sozinhos não bastam).
  Corrigido forçando `addProperty()` pra esses dois grupos
  especificamente (`STYLE_PRESET_FORCE_ADD_MATCHNAMES`). Confirmado ao
  vivo aplicando o preset real da usuária pelo caminho de produção
  (`createCaptionLayers`): as 14 propriedades de Animator que antes
  ficavam sem expressão agora vêm todas com `canSetExpression: true` e a
  expressão exata capturada.

## Nota sobre pesquisa de scripts de terceiros

Nesta sessão, o usuário pediu pra eu olhar um script de terceiros gratuito
(Textevo) só pra entender a arquitetura/mecânica geral -- não pra copiar
código. O princípio seguido (já documentado no README desde antes desta
sessão): entender a organização/objetivos é ok, mas nenhum código
protegido/proprietário de terceiros é copiado ou incorporado. Vale manter
esse mesmo cuidado se aparecer mais pesquisa desse tipo.

## Aba Text Animation (nossa versão do AfterFlix Animations)

Biblioteca de 2100 entradas/saídas de texto gerada por código nosso
(`client/textanim-library.js`), UI em `client/textanim.js`, AE em
`host/textanim.jsx` (`$.evalFile` sob demanda). Um preset = visual
escondido de um Text Animator + Range Selector; o host cria "MF In" /
"MF Out" nos textos selecionados. Detalhes e armadilhas (matchName
`ADBE Text Track Type`; addProperty com matchName errado aborta o
script sem catch) no README, "Aba Text Animation".

Teste ao vivo: a ponte 8092 some se o painel principal for fechado e
reaberto rápido demais (o motor novo tenta abrir a porta enquanto o
velho ainda segura -> "Cannot start http server for devtools"). Dá pra
continuar rodando ExtendScript pela 8094 (MF - Camadas), que usa o
mesmo motor. Erro de sintaxe num script mandado por evalScript abre um
diálogo modal no AE e trava todo evalScript até alguém clicar OK.

## Painel Elastic (atalho, Windows)

`installer/helper/MFHelper.cs` (compilado em `motion-film/bin/win/` por
`installer/build-helper.ps1`; rodar esse script depois de mexer no .cs
-- o symlink de dev usa o .exe local) + `client/elastic.js` +
`host/elastic.jsx`. Detalhes no README, "Painel Elastic no atalho".
Os controles ficam em Tools › 04 / ELASTIC. As curvas favoritas já
existem (Home › 02 / FAVORITES, `client/curve-favorites.js`, chave
`motionfilm-curve-favorites`); próximo passo: mostrar as favoritas 1-4
na janelinha do atalho (nova linha `pick curve <n>` no protocolo).

## Kit › Transitions

Categoria fixa no topo da aba Kit (nossa versão do Afterflix
Transitions): `host/transitions.jsx` (55 efeitos, camada de ajuste no
corte / indicador de tempo), `client/transitions-catalog.js`,
`client/transitions.js`, prévias em `client/assets/transitions/`
geradas por `dev/transitions-lab.jsx`. Detalhes e armadilhas no README,
"Kit › Transitions".
