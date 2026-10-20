# Mótion Film

Extensão CEP independente para Adobe After Effects 2026. A primeira versão
combina um editor visual de curvas de velocidade, controles de transformação
e utilitários de keyframes em um único painel.

## O que está incluído

- Abas de página no topo do painel (`.page-tabs`): **Home** (ícone de casa
  -- editor de curva de velocidade + Transform da camada + utilitários de
  keyframe/anchor; as seções responsivas de Text e Shape foram removidas,
  ver changelog no fim) e Kit / Icons / Captions / Effects. Trocar de aba
  troca a tela inteira --
  só a página ativa é mostrada (`hidden` em `#page-home`/`#page-text`,
  igual ao padrão já usado em outras seções condicionais do painel como
  `els.textSection.hidden`), não é uma barra lateral nem um painel
  sobreposto. Implementado em `initPageTabs()` no `panel.js`.
  - A barra de status (onde antes ficavam mensagens de erro/sucesso,
    ocupando uma faixa fixa o tempo todo) virou o lugar dessas abas. As
    mensagens de status agora aparecem como um toast flutuante
    (`position: fixed`, logo abaixo da barra de abas) só enquanto há algo
    a dizer -- por padrão fica visível uns 4s (7s se for erro, dando mais
    tempo pra ler algo com mais detalhe) e some sozinho com uma
    transição de fade, em vez de ocupar espaço fixo na tela o tempo
    todo. `setStatus(mensagem, tipo)` no `panel.js` continua sendo a
    função usada em todo o resto do código para mostrar essas mensagens
    -- só o comportamento visual dela mudou.
- **Text tab -- Character Reveal (v1):** primeira ferramenta da aba Text,
  com 4 botões (Add / Copy / Paste / Remove):
  - **Add** aplica um reveal por caractere na(s) camada(s) de texto
    selecionada(s), construído só com API nativa do After Effects (Text
    Animator + Range Selector) -- não usa nenhum efeito ou expressão de
    terceiros. Mecanismo: a propriedade Opacity do animador fica em 0%,
    e o Offset do Range Selector é guiado por **expressão** (não
    keyframes fixos) -- `linear(time, layer.inPoint, layer.inPoint +
    duration, 0, 100)` -- fazendo a janela de seleção (invisível) varrer
    os caracteres da esquerda pra direita, revelando-os em ordem. Não
    cria duplicata se a camada já tiver essa animação.
  - **Duração ajustável no próprio Effect Controls do AE**: junto com o
    Text Animator, o Add também cria um "Slider Control" nativo (não é
    plugin compilado, é o mesmo tipo de controle de "Effect > Expression
    Controls" que qualquer script pode adicionar) chamado "Duration" no
    Effect Parade da camada -- aparece como uma linha normal no painel
    Effect Controls, com cronômetro próprio, editável direto ali sem
    precisar abrir esse painel. A expressão do Offset lê esse slider
    (`effect("Duration")("Slider")`), então arrastar o valor (ou trocar
    o inPoint/duração da própria camada) atualiza o tempo do reveal na
    hora, sem precisar re-criar keyframe nenhum.
    - Isso foi pedido depois de ver que o Textevo tem um painel de
      controles parecido no Effect Controls -- só que o deles é um
      efeito Pseudo *compilado* (plugin binário feito com o SDK de
      efeitos da Adobe), incluindo um agrupamento visual aninhado
      ("Transform > AnchorPoint > X/Y/Z") que só um plugin compilado
      consegue desenhar. Isso não é algo que dê pra fazer só com
      ExtendScript/CEP -- por isso o "Duration" aparece como uma linha
      simples no Effect Controls, não um grupo aninhado. O v1 cobre só
      Duration (por escolha explícita, pra não superdimensionar o
      escopo); outros parâmetros do Textevo (Strength, Direction, From
      Index, Randomize/Random Seed) podem virar sliders/dropdowns do
      mesmo jeito depois, sob demanda.
  - **Copy** lê o estado exato (valor + cada keyframe, com tipo de
    interpolação e easing temporal) das propriedades que essa ferramenta
    usa (Opacity, Start/End do Range Selector, Smoothness, Ease
    High/Low) mais o valor atual do slider Duration, da camada
    selecionada, e guarda em memória no painel (não sobrevive a um
    recarregamento, mesmo padrão do `tempCopy` que scripts parecidos
    costumam usar). O Offset em si não é copiado -- é guiado por
    expressão a partir do Duration, então seu valor instantâneo no
    momento da cópia não teria sentido em outra camada.
  - **Paste** aplica esse estado copiado na(s) camada(s) selecionada(s),
    criando a animação e o slider Duration do zero se a camada ainda não
    tiver.
  - **Remove** tira a animação e o slider Duration criados por essa
    ferramenta (identificados pelo nome "Motion Film Reveal"/"Duration"),
    sem mexer em outros efeitos/animadores que o usuário tenha criado
    manualmente no AE.
  - O animador e o slider são identificados pelo nome, então Copy/Remove
    sempre miram os controles certos mesmo se a camada tiver outros
    efeitos/animadores nativos criados à mão.
  - **Nota sobre a pesquisa do TextEvo**: antes de implementar, o arquivo
    `textevo2.jsx` (script de terceiros, gratuito, mencionado pelo
    usuário) foi lido só pra entender a arquitetura geral -- não pra
    copiar código. Achado relevante: das 34.238 linhas do arquivo,
    ~34.000 são o framework DuAEF embutido (GPL-3.0, de terceiros); o
    código específico do Textevo é só ~220 linhas. Essa parte específica
    confirmou que o mecanismo central é exatamente isso (Text Animator +
    Range Selector nativos do AE, animando o Offset) -- um jeito padrão
    e bem documentado de fazer reveal de texto, não uma técnica exclusiva
    do Textevo. O algoritmo específico de escalonamento por caractere do
    Textevo (uma expressão referenciando um efeito pseudo oculto chamado
    `Pseudo/textevo`) não foi lido/copiado de propósito, por ser
    provavelmente a parte proprietária/criativa real da ferramenta deles.
  - Como o After Effects não está disponível neste ambiente, essa
    implementação não pôde ser validada numa composição real -- os match
    names usados (`ADBE Text Animator`, `ADBE Text Selector`, `ADBE Text
    Percent Start/End/Offset`, `ADBE Text Selector Smoothness`, `ADBE
    Text Levels Max/Min Ease`, `ADBE Slider Control`) foram conferidos
    contra a documentação oficial de scripting do After Effects e
    exemplos reais da comunidade antes de escrever o código, mas ainda
    vale confirmar instalando o painel no AE -- em especial a expressão
    do Offset (`effect("Duration")("Slider")` dentro de um `linear(...)`
    ancorado em `thisLayer.inPoint`), que é a parte nova/mais arriscada
    desta rodada.
- Cada seção do painel (Curves, Text, Layer Transform, Shape Contents, Shape
  Properties) tem visual de "pasta": uma aba sentando sobre um corpo com
  cantos arredondados, tudo dentro do próprio cartão daquela seção. Clicar
  na aba recolhe/expande só aquela seção (não é um acordeão -- as outras
  continuam do jeito que estavam), o que deixa dar para ver a próxima
  seção sem precisar rolar a tela quando uma não interessa no momento. O
  estado de cada seção (recolhida ou não) fica salvo (`localStorage`,
  mesmo mecanismo já usado para a cor de destaque/fundo), então não
  reseta toda vez que o painel reabre. Implementado em `index.html`
  (`.section-tab` / `.section-body` dentro de cada
  `<section data-section-id="...">`), `styles.css` e
  `initCollapsibleSections()` em `panel.js`.
  - Uma versão com recorte diagonal de verdade (o rótulo curto "01 /
    CURVES" dentro de um corte no canto, tipo pasta de arquivo física, e
    o título por extenso numa barra plana separada) foi tentada e
    revertida -- três tentativas (duas com `clip-path` do CSS, uma com
    `<path>` de SVG inline) renderizaram corretamente num navegador
    comum, mas saíram erradas dentro do painel de verdade no After
    Effects (recorte separado do resto como uma "bolha", cantos
    pontudos), e a última não pôde ser confirmada visualmente antes de
    pedir a reversão. Voltou pra essa versão simples (sem recorte), que
    é a que foi de fato confirmada funcionando dentro do AE.
- Painel de velocidade baseado na derivada do mesmo Bézier temporal usado pelo
  easing aplicado ao After Effects: os dois pontos de velocidade zero ficam
  fixos, enquanto a silhueta pode ser arrastada em tempo real e aplicada
  automaticamente ao soltar.
- Grade 3x3 de ponto âncora ao lado do gráfico de velocidade: reposiciona o
  anchor point da(s) camada(s) selecionada(s) e compensa a Position
  (considerando Scale e Rotação, inclusive em cada keyframe já existente)
  para a camada não pular na tela nem perder a animação já feita.
- Controle de influência de entrada/saída e modos Bezier, Continuous e Hold.
- Controles de Anchor Point, Position, Scale, Rotation e Opacity com campos
  arrastáveis (clique e arraste para alterar o valor, como nos painéis
  nativos do After Effects). Orientation, X/Y rotation, Skew e Skew axis
  foram removidos do painel para manter a aba enxuta.
- Painel de propriedades (03/LAYER) que se adapta ao tipo de camada
  selecionada, como o painel Properties nativo do After Effects:
  - Qualquer camada: Layer Transform (Anchor Point, Position, Scale,
    Rotation, Opacity).
  - Shape Layers: Shape Properties (Size/Roundness do primeiro shape
    encontrado, Fill, Stroke com cor/largura/opacidade/line cap/line join)
    e Shape Transform (transform do grupo que contém esse shape).
  - Text Layers: conteúdo do texto, fonte (com lista de busca de todas as
    fontes instaladas, igual ao painel nativo) e estilo (lista filtrada
    pelos estilos daquela família), tamanho, tracking, leading (com toggle
    de Auto), Fill, Stroke, Horizontal/Vertical Scale, Kerning, All Caps,
    Small Caps e alinhamento de parágrafo.

  Limitações conhecidas dessa primeira versão do painel adaptativo:
  - Em Shape Layers, apenas o **primeiro** shape path (retângulo, elipse ou
    outro) encontrado dentro do grupo de conteúdo é mostrado -- camadas com
    múltiplos shapes/grupos ainda não mostram os demais.
  - Suporte comleto de Size/Roundness é para Rect e Ellipse; outros tipos de
    shape (Star, Path livre) aparecem sem esses campos específicos.
  - Campo de fonte (família/estilo) usa `app.fonts.allFonts`, a API de
    fontes do After Effects (disponível a partir da versão 24.0, então já
    presente no AE 2026) para listar as fontes de verdade instaladas no
    computador, com busca -- igual ao painel nativo.
  - Campos de texto (fonte, tamanho, tracking etc) não têm keyframe
    individual pelo painel -- no After Effects, toda a formatação de texto
    vive numa única propriedade "Source Text", então uma mudança nesses
    campos edita o valor atual dessa propriedade (e respeita keyframes que
    já existam nela), mas não oferece um botão de keyframe dedicado por
    campo ainda.
  - Superscript e Subscript do texto nativo ainda não foram incluídos.
    Ligatures, Hindi Digits, Baseline Shift e Tsume foram avaliados e
    removidos de propósito -- não são usados no escritório e só ocupavam
    espaço no painel.
  - Horizontal/Vertical Scale saíram das linhas do painel e viraram um
    submenu: o ícone de Font Size (que também identifica o campo) abre um
    popover com os dois campos, já que são usados com pouca frequência.
  - Font Size+Leading e Kerning+Tracking dividem uma linha compacta cada,
    com um ícone no lugar do label de texto para cada campo -- mesmo
    layout de duas colunas do painel Character nativo do After Effects.
    Os outros campos (Fill, Stroke, Caps, Position) continuam em linha
    própria com o label de texto, como já eram. Essas
    duas linhas reaproveitam a mesma grade `.s-row` (label | stopwatch |
    modificador | controles) que todas as outras linhas do painel já
    usam -- o ícone ocupa a coluna onde ficaria o label de texto, então o
    primeiro campo de cada linha começa exatamente na mesma posição
    horizontal que o campo de Fill/Stroke/Caps/Position, em vez de ter
    sua própria grade separada (que foi o que desalinhou a primeira
    tentativa desse layout).
  - O ícone de Leading também funciona como o toggle de Auto Leading
    (liga/desliga ao clicar); o ícone de Kerning alterna entre Manual,
    Metrics e Optical a cada clique -- os três botões separados que
    existiam antes não cabiam ao lado do campo de Tracking na mesma
    linha, então viraram um ícone só que troca de acordo com o modo
    atual. O campo ao lado do ícone de Kerning é sempre o valor manual;
    digitar nele muda o modo para Manual (comportamento já existente,
    só a apresentação mudou).
  - Todos os ícones do painel de texto (Font Size, Leading, Kerning,
    Tracking, Caps, Position) usam a mesma classe de botão (`.s-icon-btn`)
    e o mesmo tamanho de glifo (`TEXT_ICON_SIZE`, 22 -- ~40% maior que a
    primeira versão desses ícones), para todos ficarem do mesmo tamanho
    entre si e legíveis. Font Size usa um "T" grande + um "T" pequeno (o
    pictograma padrão de tamanho de texto); o modo Manual do Kerning usa
    "AV" com um "0" pequeno no canto, para não parecer um dígito solto
    flutuando -- os dois seguem o mesmo padrão visual (glifo grande +
    glifo pequeno no canto) já usado em Small Caps/Superscript/Subscript.
  - Corrigido: a lista de fontes podia ficar mostrando "No matches." pro
    resto da sessão do painel depois de uma única resposta vazia do host
    (`getInstalledFonts`). Causa: `fontListCache` guarda a lista já
    carregada para não pedir de novo a cada abertura do seletor, mas
    `loadFontList` decidia se já tinha cache com `if (fontListCache)` --
    e um array vazio (`[]`) também é "verdadeiro" em JS, então se a
    primeira resposta viesse vazia por qualquer motivo (por exemplo, o
    sistema de fontes do AE ainda não estar pronto logo depois do painel
    carregar), esse vazio ficava guardado como se fosse a lista completa
    e nunca mais tentava de novo naquela sessão. Agora só um resultado
    com pelo menos uma fonte é guardado em cache; uma resposta vazia
    deixa a próxima tentativa pedir de novo ao host. Essa correção de
    cache não era a causa raiz do "No matches." persistente, só um
    sintoma que ela deixava mais permanente -- **causa raiz real,
    confirmada por um erro ao vivo**: `getInstalledFonts` usava
    `array.indexOf(...)` para checar se um estilo de fonte já tinha sido
    visto, e travava logo na primeira fonte lida com `ReferenceError:
    Function families[family].indexOf is undefined` -- o motor de script
    do After Effects (ExtendScript) não garante `Array.prototype.indexOf`
    do jeito que engines JS modernos garantem, diferente do
    `String.prototype.indexOf` (usado em outro lugar do arquivo, esse
    sim seguro) que é suportado desde sempre. Trocado por um loop manual
    de checagem de duplicata, que funciona em qualquer motor. A lista de
    fontes ainda vinha vazia com o cache já corrigido porque o host
    nunca chegava a devolver nenhuma fonte -- crashava antes.
  - Diagnóstico temporário: se `getInstalledFonts` ainda vier vazio ou
    der erro, a barra de status do painel mostra contadores reais
    (`groupCount`, `fontCount`, `skippedNoRead`, `skippedNoFamily` ou
    `allFontsThrew`) em vez de só uma mensagem genérica -- útil pra achar
    a causa raiz sem precisar adivinhar pela imagem. Deve ser removido
    (`diagMessage` e os dois pontos que a chamam em `panel.js`, os campos
    `diag` em `getInstalledFonts` no `host.jsx`) depois de confirmado que
    a lista de fontes carrega normalmente.
  - A lista de busca de fontes ganhou uma barra de rolagem fina no tema
    escuro do painel; sem isso o Chromium do CEP desenhava a barra de
    rolagem nativa clara por cima do painel escuro.
  - Trocar a fonte pelo painel agora funciona de ponta a ponta (confirmado
    em uso real). A causa raiz era um bug de referência no `panel.js`: o
    clique num item da lista de fontes chamava `closeFontPicker()` (que
    zera `picker.onPick`) e só *depois* checava `if (picker.onPick)` --
    como `fontPicker` e `picker` são o mesmo objeto, essa checagem já lia
    o valor recém-zerado, então o callback que aplica a fonte nunca era
    chamado. Duas tentativas anteriores mexeram no lookup de fonte do
    `host.jsx` sem efeito nenhum porque o problema nunca esteve lá --
    essas mudanças continuam no código por serem melhorias válidas por
    conta própria (lookup mais robusto contra a mesma fonte de dados da
    lista, erro explícito se a escrita não colar, nudge real de
    `comp.time` para forçar o redesenho do viewer).
- Botão de cronômetro para criar keyframe e botão `Set` para aplicar o valor
  atual sem keyframe.
- Utilitários `Reverse`, `Reposition` e `Reset`. `Reverse`, `Reposition` e o
  "Apply current" da curva de velocidade primeiro capturam a seleção de
  keyframes em toda a composição e só depois modificam qualquer coisa --
  o After Effects limpa a seleção de keyframes da composição inteira assim
  que os keyframes de uma propriedade são reconstruídos, então ler e
  escrever propriedade por propriedade na mesma passada fazia só a primeira
  camada tocada ser processada de fato.
  - Os botões de `Reverse` e `Reset` foram removidos da barra de ações da
    aba Curves (a lógica em si continua em `host.jsx`/`keyframeUtility`,
    só não tem mais botão que a chame -- `Reposition` continua com o seu).
    A barra agora tem, nessa ordem: **Apply Curve**, **Reposition**,
    **Copy Keyframe Curves**, **Paste Keyframe Curves**.
  - **Copy/Paste Keyframe Curves** são um clipboard separado do "Apply
    Curve" -- um não interfere no outro. Diferença: "Apply Curve" pega a
    curva única desenhada no editor gráfico e aplica ela, igual, em
    *todos* os keyframes selecionados; "Copy Keyframe Curves" lê a curva
    de temporização (tipo de interpolação + ease de entrada/saída) de
    *cada* keyframe selecionado individualmente, na ordem em que
    aparecem -- então se os keyframes selecionados já tiverem curvas
    diferentes entre si, cada uma é guardada como está, sem uniformizar
    nada. "Paste Keyframe Curves" aplica essa sequência de curvas
    copiadas numa seleção de keyframes completamente diferente (outra
    propriedade, outra camada, o que for), na mesma ordem -- se a nova
    seleção tiver mais keyframes do que curvas copiadas, a sequência
    repete em ciclo. Só a curva é copiada/colada -- valor e tempo de cada
    keyframe não são tocados. Guardado em memória no painel (mesmo
    padrão de clipboard já usado nas outras ferramentas desta sessão),
    não sobrevive a um recarregamento.
- Botões de keyframe (relógio) na aba de Transform: usam `setValueAtTime`
  em qualquer propriedade, mesmo sem keyframes existentes; a checagem
  `isSeparationLeader` que causava falsos positivos e bloqueava alguns
  cliques silenciosamente foi removida (mesma causa já identificada e
  corrigida no ponto de âncora). Depois de criar o keyframe, a propriedade
  é selecionada automaticamente (`property.selected = true`), o que faz o
  After Effects revelar a track dela no timeline sem precisar apertar "U".
- O pause do polling de fundo (que evita o campo ser reconstruído no meio
  de uma interação) agora começa já no `pointerdown`, não só depois que o
  arraste ultrapassa o limiar de 3px -- um arraste lento podia ficar abaixo
  desse limiar por mais tempo que um ciclo de polling (700ms), fazendo o
  campo ser reconstruído no meio do gesto e o arraste reiniciar sozinho.
- Seletores de cor (Fill/Stroke do texto, tema): incluem campo hex e um
  botão de conta-gotas real via `window.EyeDropper` -- o conta-gotas nativo
  do seletor de cor do navegador não funciona de forma confiável dentro de
  um painel CEP (Chromium embutido sem suporte completo a captura de tela
  no nível do sistema). O seletor de cor nativo também parava de responder
  quase instantaneamente porque o polling em segundo plano reconstruía o
  campo no meio da interação; agora o polling é pausado enquanto o campo
  está em foco, igual já era feito para os campos de texto.
- `Reverse` troca os valores e espelha os easings de entrada/saída para
  preservar a curva da animação.
- `Reposition` move os keyframes selecionados para o `inPoint` de cada
  camada, mantendo o espaçamento entre eles.
- `Reset` remove todos os keyframes das propriedades das camadas selecionadas.
- Personalização persistente da cor de destaque e do fundo do painel.
- Botão "Null from selection" (rodapé): o Null criado agora dura exatamente
  do menor `inPoint` ao maior `outPoint` entre as camadas selecionadas, em
  vez de durar a composição inteira -- se a Camada 2 termina em 1s e a
  Camada 3 termina em 2s, o Null criado a partir das duas vai de 0 a 2s
  (o mais cedo até o mais tarde), não até o fim da timeline.
  - **Causa raiz do "sempre passa um pouco do fim" encontrada via
    diagnóstico real** (não era ruído de ponto flutuante, que foi a
    primeira tentativa e não resolveu): setar `layer.inPoint` no AE move
    a camada inteira preservando a duração *atual* dela, em vez de
    cortar no lugar -- ou seja, também desloca o `outPoint` junto. Um
    teste real confirmou isso: pedindo 10-49f, o AE guardava 10-59f, e a
    sobra (10 frames) batia exatamente com o valor do `inPoint` aplicado.
    Isso também explica por que a sobra variava por camada nos relatos
    anteriores (vídeo certo, texto um pouco a mais, adjustment layer
    muito a mais) -- a sobra é sempre igual ao `inPoint` calculado
    (`minIn`) daquele caso, então dependia de onde a seleção começava.
    A correção inverte a ordem: `inPoint` é aplicado primeiro (enquanto
    o `outPoint` ainda está no valor padrão bem largo, então o
    deslocamento não importa) e o `outPoint` é aplicado por último, pra
    ele ficar exatamente no valor pedido não importa o que a atribuição
    do `inPoint` tenha feito com ele antes.
  - O diagnóstico (`diag` no retorno de `createShapeNull`, mostrado na
    barra de status pelo `createLayer` do `panel.js`) continua no código
    por enquanto -- é o que permitiu achar essa causa raiz com dados
    reais em vez de mais um chute. Deve ser removido depois de
    confirmado que o Null passa a bater exatamente com o pedido.
  - Havia também um diagnóstico temporário mais antigo (da investigação
    da aba de Texto, já resolvida) que reescrevia a barra de status a
    cada ciclo de polling (700ms) sempre que uma camada não-texto
    estivesse selecionada -- o que incluía qualquer Null recém-criado,
    já que ele é uma shape layer. Isso apagava a mensagem de diagnóstico
    do Null quase instantaneamente, então foi removido.
- Botões do rodapé (Null/Adjustment/Solid) ficaram ~8px mais altos.
- Corrigido: o cursor de edição de texto no viewport (canvas) voltava para
  o início do texto sempre que o usuário parava de digitar por perto de
  1 segundo. Causa: o sinal usado para detectar "a camada selecionada
  mudou?" (`currentSelectedLayerKey`, em `panel.js`) combinava o índice
  da camada com o nome dela -- mas uma camada de texto sem nome próprio
  tem o nome exibido espelhando o próprio conteúdo do Source Text, então
  o nome muda a cada tecla digitada. Isso fazia o polling de fundo (a
  cada 700ms) achar que a camada tinha "mudado" o tempo todo enquanto o
  usuário digitava, disparando uma releitura de `sourceText.value` -- e
  ler essa propriedade enquanto existe uma edição de texto ativa no
  viewport faz o próprio After Effects encerrar/limpar essa edição,
  resetando o cursor. A correção usa só o índice da camada nesse sinal,
  não mais o nome.

## Instalação como extensão CEP

1. Copie a pasta `motion-film` para a pasta de extensões CEP:
   - Windows: `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\`
   - macOS: `/Library/Application Support/Adobe/CEP/extensions/`
2. Em desenvolvimento, habilite extensões não assinadas:
   - Windows: crie `PlayerDebugMode` como string com valor `1` em
     `HKEY_CURRENT_USER\Software\Adobe\CSXS.12`.
   - macOS: execute `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`.
3. Reinicie o After Effects.
4. Abra em `Window > Extensions > Mótion Film`.

O número `CSXS.12` pode precisar acompanhar a versão do CEP instalada no seu
After Effects.

## Changelog -- renomeação e ajuste visual das seções colapsáveis

- **Nome com acento**: "Motion Film" virou "Mótion Film" no título da aba
  (`<title>` e `<h1>` em `client/index.html`), no nome exibido no menu do AE
  e no nome do pacote (`ExtensionBundleName` e `<Menu>` em
  `CSXS/manifest.xml`), e em todos os textos visíveis dentro do
  `host/host.jsx` (nomes dos grupos de Undo, nome do Text Animator criado
  pelo Character Reveal, mensagens de erro). **Não foi alterado**:
  `ExtensionBundleId`/`Extension Id` (`com.motionfilm.app`) em
  `manifest.xml`, porque isso é um identificador interno de registro da
  extensão no AE, não um nome visível -- trocá-lo obrigaria a reinstalar/
  re-registrar a extensão. Atenção: como o nome interno do Text Animator
  mudou de "Motion Film Reveal" para "Mótion Film Reveal" (usado para
  identificar a animação nas ações Copy/Paste/Remove da aba Text), uma
  animação de Character Reveal criada por uma versão anterior desta
  extensão não será reconhecida pelas versões Copy/Paste/Remove desta
  versão -- só afeta quem já tinha usado essa ferramenta antes desta
  mudança de nome.
- **Seção colapsada sem linha de divisão**: cada seção tipo "pasta" (`.section`
  em `client/styles.css`) tinha a aba (`.section-tab`) sempre com cantos
  arredondados só em cima (`border-radius: 12px 12px 0 0`), então uma seção
  colapsada ficava com o canto de baixo reto -- contra o fundo mais escuro da
  página, isso lia como uma linha de corte reta. Adicionado
  `.section.is-collapsed .section-tab { border-radius: 12px; }` para
  arredondar os 4 cantos quando colapsada, virando uma pílula fechada sem
  aresta visível. Também unificado `.section-body` para usar o mesmo fundo da
  aba (`var(--panel-raised)`, antes era `var(--panel-soft)`, um tom mais
  escuro) -- não ficando mais diferente mesmo quando expandida, dando a
  impressão de aba/corpo como uma peça só. Ainda restava uma sombra escura
  visível sob a aba fechada (`.section { box-shadow: 0 4px 14px
  rgba(0,0,0,.22) }`, aplicada em toda seção o tempo todo) -- ao lado do
  espaço até a próxima seção, essa sombra lia como uma faixa escura
  residual. Adicionado `.section.is-collapsed { box-shadow: none; }` para
  remover a sombra só enquanto a seção está fechada (permanece normal
  quando expandida). Sem essa sombra preenchendo parte do vão, o espaço de
  10px entre seções (`.section { margin-bottom: 10px }`) passou a parecer
  grande demais entre pílulas fechadas empilhadas -- reduzido a 0 só no
  estado colapsado (`.section.is-collapsed { margin-bottom: 0 }`, ajustado
  em várias rodadas -- 10px -> 6px -> 3px -> 1px -> 0 -- a partir de
  feedback visual de que ainda parecia grande, com o usuário desenhando o
  tamanho de vão que imaginava), mantendo os 10px normais quando
  expandida. Numa dessas rodadas o valor já estava em 1px no código mas o
  usuário ainda via o vão grande no AE de verdade mesmo fechando o AE e
  trocando a pasta inteira a cada teste. A causa real não era cache da
  pasta (essa parte já estava certa) -- é o cache em disco do próprio
  motor CEF que roda o painel (o Chromium embutido no CEP), que pode
  reter recursos carregados via `file://` entre sessões sem invalidar
  puramente por reiniciar o app ou trocar os arquivos no disco. Corrigido
  na raiz adicionando `--disable-http-cache` e `--disk-cache-size=0` ao
  `<CEFCommandLine>` do `CSXS/manifest.xml` -- assim o painel nunca serve
  uma versão antiga de `client/` em disco, e não é mais preciso caçar
  pasta de cache nenhuma a cada rodada de teste.
  - Depois disso o usuário reiniciou o computador inteiro e limpou o cache
    do AE e o vão continuou idêntico -- prova definitiva de que não era
    cache de jeito nenhum (nem de pasta, nem do CEF). A causa real, achada
    inspecionando o painel *rodando de verdade* dentro do AE (ver "Setup
    de desenvolvimento" abaixo): `max-height: 0` nunca reduz o `padding`
    de um elemento, só o conteúdo -- isso é comportamento padrão do CSS
    (não bug do CEF/AE), só que eu tinha checado até então só propriedades
    de estilo (`opacity`, `border-color`), nunca a altura renderizada de
    verdade. O `.section-body` colapsado media 31px reais de altura
    (exatamente os 15px+15px de `padding` vertical, já que `border-top` é
    0) mesmo com `opacity: 0` -- invisível, mas ainda empurrando o próximo
    card pra baixo. Corrigido zerando `padding-top`/`padding-bottom` e
    `border-width` também no estado colapsado (`.section.is-collapsed
    .section-body { padding-top: 0; padding-bottom: 0; border-width: 0;
    ... }`), com `padding` incluído na lista de `transition` do
    `.section-body` pra continuar animando suave. Depois disso a altura
    real de uma seção fechada caiu de 91px para 60px (só a aba, 0 de
    sobra) -- confirmado via inspeção remota, não só lendo o código.
  - Com o bug real corrigido, a redução de `margin-bottom` só no estado
    colapsado (era só uma compensação pro vão residual do bug do padding)
    deixou de fazer sentido -- removida (`.section.is-collapsed` não mexe
    mais em `margin-bottom`), voltando ao mesmo `10px` de `.section {
    margin-bottom: 10px }` pros dois estados, pra manter o layout com um
    espaçamento padrão único. Confirmado via inspeção remota que o vão
    entre seções fechadas ficou em exatos 10px, igual ao design original.
  - **Cursor virou uma bolinha**: efeito colateral de deixar a sessão de
    debug remoto (usada pra achar o bug do padding acima) conectada --
    screencast e emulação de toque do CDP ficam ativos enquanto o DevTools
    remoto está inspecionando o painel, e isso desenha um indicador
    circular de toque por cima do cursor real. Corrigido desligando
    `Page.stopScreencast`, `Emulation.setEmitTouchEventsForMouse` e
    `Overlay.setInspectMode`/`Overlay.disable` via CDP e encerrando a
    conexão de debug -- não é um problema do CSS/`client/`, só precisa
    fechar/reabrir o painel depois que a sessão de debug for encerrada.

## Changelog -- overflow do campo de Stroke Opacity em Shape Properties

A linha "Opacity" de Shape Properties (`buildShapeOpacityRow` em
`client/panel.js`) mostra dois campos numéricos no mesmo `.s-controls`
(Fill e Stroke), cada um usando `.s-field` com `width: 88px` fixo
(`flex: 0 0 auto`, não encolhe). Somando os dois campos (88px + 88px) com
o resto da linha (`.s-extra-cell` cabendo o segundo campo, labels,
stopwatches, gaps), o total passa muito do espaço que a coluna de
controles (`minmax(0, 1fr)` do grid `.s-row`) realmente tem disponível --
medido ao vivo no painel real (via a porta de debug, `client/.debug`) em
21px de campo de Stroke saindo pra fora do card. Corrigido adicionando a
classe `s-field--split` (`.s-field.s-field--split { width: 60px; padding:
0 6px; }`) só nos dois campos dessa linha específica (`field.wrap.
classList.add("s-field--split")` em `buildShapeOpacityRow`) -- as outras
linhas de campo único no painel continuam com os 88px normais, só essa
linha com dois campos lado a lado fica mais compacta. Reconfirmado ao
vivo: o campo de Stroke passou a terminar 35px dentro da borda do card.

## Setup de desenvolvimento

- **Symlink em vez de copiar a pasta manualmente**: o usuário testava
  apagando `C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\
  motion-film` e colando esta pasta de novo a cada mudança -- aumentando as
  chances de testar uma versão desatualizada por engano (foi exatamente o
  que aconteceu no meio da investigação do vão acima). Trocado por um
  link simbólico apontando pra esta pasta (`New-Item -ItemType
  SymbolicLink`, requer PowerShell como Administrador), então qualquer
  edição aqui aparece no AE só fechando/reabrindo o painel, sem cópia
  manual nunca mais.
- **Porta de debug remoto do CEP**: adicionado um arquivo `.debug` na raiz
  do projeto (mesmo nível de `CSXS/`), expondo a porta `8092` para o host
  `AEFT`. Isso permite inspecionar o painel *rodando de verdade* dentro do
  After Effects a partir de fora -- por exemplo abrindo
  `http://localhost:8092` num navegador comum (lista os alvos
  inspecionáveis) ou indo direto no `devtools/inspector.html?ws=...`
  daquele alvo pra abrir o DevTools completo. Foi assim que o bug real do
  `padding` acima foi encontrado -- lendo só o código/CSS não bastou dessa
  vez. Também dá pra rodar JavaScript arbitrário no painel ao vivo via o
  protocolo CDP bruto por WebSocket (`Runtime.evaluate`), útil quando as
  ferramentas de inspeção usuais não conseguem me mostrar a árvore de
  elementos do DevTools de forma legível.

## Changelog -- Character Reveal: modos de direção + canais extras

Depois de inspecionar ao vivo (via a porta de debug acima) como o script
de terceiros TextEvo2 monta a animação dele numa camada real -- só
observando o que ele cria no AE (Effect Controls, Text Animator,
expressões), nunca o painel/código deles --, o Character Reveal desta
extensão ganhou o mesmo tipo de mecânica, implementada de forma
independente com API pública de scripting.

- **O que mudou**: `host/host.jsx`, funções `addTextAnimation`,
  `copyTextAnimation`, `pasteTextAnimation`, `removeTextAnimation` (todas
  em torno da linha 2545 em diante). Nenhuma mudança em `client/` --
  continua só os 4 botões (Add/Copy/Paste/Remove); os novos parâmetros
  aparecem no Effect Controls do AE, igual o Duration já fazia.
- **Novos sliders no Effect Controls** (todos com valor padrão neutro, ou
  seja, uma animação recém-criada continua parecendo um fade de opacidade
  puro até o usuário decidir mexer neles):
  - `Direction` (1-6): Left to Right (padrão) / Right to Left / Center
    Out / Edges In / Random / From Index.
  - `From Index`: usado só quando Direction = 6.
  - `Random Seed`: usado só quando Direction = 5.
  - `Position Offset` (px, padrão 0), `Scale Start` (%, padrão 100),
    `Rotation Start` (graus, padrão 0) -- cada caractere anima desse
    valor até o natural conforme é revelado, além do fade de opacidade.
- **Mecânica**: trocado o seletor de `ADBE Text Selector` (Range
  Selector) por `ADBE Text Expressible Selector`. Um Range Selector só
  consegue deslizar uma janela de seleção na ordem natural dos
  caracteres -- não dá pra fazer "do centro pra fora" ou "aleatório" só
  com ele. O Expressible Selector roda a expressão uma vez por
  caractere (`textIndex`/`textTotal`, variáveis nativas do AE), o que
  permite calcular quando CADA caractere revela, na ordem que Direction
  pedir. `Position`/`Scale`/`Rotation` foram adicionados como Animator
  Properties nativas na mesma Animator, cada uma só repassando o valor
  do slider correspondente (`effect("X")("Slider")`) -- o blend por
  caractere (natural em Amount 0%, valor do slider em Amount 100%) já é
  automático entre todas as Animator Properties de um mesmo Animator,
  então não precisou reimplementar o timing em cada canal.
- **Validado ao vivo, não só lido**: cada peça (criação do seletor,
  criação das 3 Animator Properties novas, as 6 fórmulas de Direction,
  Copy/Remove/Paste em sequência) foi testada de verdade contra o AE
  rodando de verdade, numa composição de teste isolada (criada e
  destruída via script, sem tocar no projeto do usuário) -- usando
  `$.evalFile()` via a ponte de debug pra recarregar o `host.jsx`
  editado dentro da sessão do AE já aberta, sem precisar reiniciar o AE
  a cada mudança de código. Todas as 6 direções resultam em
  `expressionError` vazio; o ciclo completo Add -> Copy -> Remove ->
  Paste -> Copy de novo bate com os mesmos valores em ambas as pontas.
- **Descoberta lateral**: `Property.setPropertyParameters()` num
  Dropdown Menu Control recém-criado lança `ReferenceError: Object is
  invalid` nesta versão do AE (26.3x87), não importa como o array de
  itens é construído -- por isso Direction é um Slider numérico (1-6)
  em vez de dropdown com nomes. Confirmado ao vivo antes de desistir da
  abordagem, não chutado.
- **Scale no eixo Z fica travado em 100%** mesmo com a expressão
  setando `[s,s,s]`, quando a camada de texto não é 3D -- comportamento
  do próprio AE (Z-scale não se aplica em camada 2D), não um bug daqui;
  os eixos X/Y (os que importam visualmente) respondem certinho.

## Changelog -- seletor de Direction por clique, sincronizado ao vivo

O `Direction` (1-6) da seção acima só existia como um número cru no
Effect Controls -- pedido do usuário pra virar algo clicável, com os
nomes das opções, no próprio painel (mostrado um dropdown nativo do AE
como referência do resultado desejado). Como `setPropertyParameters` num
Dropdown Menu Control está quebrado nesta versão do AE (ver changelog
acima), a solução ficou inteiramente do lado do painel:

- **`client/index.html`**: um botão `#text-anim-direction` (reaproveita a
  classe `.tx-font-trigger`, mesmo visual do seletor de fonte) na seção
  Character Reveal, mostrando o nome da direção atual + chevron. Some
  desabilitado até a camada selecionada já ter uma animação (mesma ideia
  do botão Paste começar desabilitado até algo ser copiado).
- **`client/panel.js`**: um popover novo e menor que o `fontPicker`
  (`buildChoicePicker`/`openChoicePicker`/`closeChoicePicker`) -- sem
  campo de busca, só a lista de 6 opções com uma bolinha marcando a
  atual (`.fp-item-dot`, nova regra em `styles.css`), reaproveitando as
  mesmas classes `.fp-popover`/`.fp-list`/`.fp-item` do seletor de fonte
  pra não inventar visual novo. `TEXT_REVEAL_DIRECTIONS` mapeia os
  valores 1-6 pros nomes (`Left to Right`, `Right to Left`, `Center Out`,
  `Edges In`, `Random`, `From Index`) -- o mesmo array serve de fonte
  única pro popover e pro texto mostrado no botão.
- **Sincronizado ao vivo**: `refreshTextReveal()` entrou no mesmo loop de
  poll de 700ms que Transform/Shape/Text já usavam, com a mesma técnica
  de key de camada por índice (nunca nome, ver lição 4 do handoff) pra só
  reconsultar quando a seleção muda de verdade -- mais um "refresh
  forçado" chamado direto depois de Add/Paste/Remove, já que essas ações
  podem mudar se a animação existe sem a seleção em si mudar. Duas
  funções novas em `host.jsx`: `readTextRevealDirection` (leitura) e
  `setTextRevealDirection` (escrita, só quando a camada já tem a
  animação -- mesma checagem de `findTextAnimator` usada em todo o resto
  do arquivo).
- **Testado ao vivo, ciclo completo**: numa composição de teste isolada,
  cliquei o botão Add de verdade (não só chamei a função), abri o
  popover de verdade, cliquei "Center Out" de verdade, e conferi tanto o
  texto do botão no painel (`Center Out`) quanto o valor real do slider
  no Effect Controls do AE (`3`) -- bateram. Desmarcar a camada também
  desabilita o botão de novo, como esperado.

## Changelog -- nome do slider Direction mostra a opção no Effect Controls

Depois de ver o seletor por clique funcionando, o usuário pediu pra
também dar pra reconhecer a direção de cada camada olhando só o Effect
Controls do AE, sem precisar abrir o painel -- ideal pra checar várias
camadas de texto rapidamente. Como o Dropdown Menu Control nativo está
confirmado quebrado nesta versão do AE (changelog acima -- tentei mais
5 variações ao vivo antes de desistir de novo: delay via `$.sleep`,
setar o valor antes, chamar duas vezes seguidas, dentro de um undo
group, e até via `app.scheduleTask` assíncrono -- todas falham igual),
a solução ficou inteiramente do lado do nome do slider:

- **`host/host.jsx`**: `applyDirectionLabel(layer, value)` renomeia o
  próprio slider "Direction" pra incluir a opção escolhida entre
  parênteses -- `Direction (Random)`, `Direction (Center Out)` etc.
  (`TEXT_DIRECTION_LABELS`, mesma ordem 1-6 que `TEXT_REVEAL_DIRECTIONS`
  em `client/panel.js` -- os dois têm que concordar). Chamado em três
  pontos: logo que o slider é criado (`addTextAnimation`, direção
  padrão), depois de colar (`pasteTextAnimation`), e depois de trocar
  pelo picker do painel (`setTextRevealDirection`) -- e também **toda
  vez que o valor é lido** (`readTextRevealDirection`, chamado a cada
  poll de 700ms), então se o usuário editar o número cru direto no
  Effect Controls (sem passar pelo painel), o nome se autocorrige
  sozinho no próximo poll, sem precisar reabrir nada.
- **`findSliderControl` precisou aceitar o nome com o sufixo**: como o
  nome real do slider deixa de ser exatamente `"Direction"` depois da
  primeira renomeação, o match passou a aceitar tanto o nome puro quanto
  qualquer coisa começando com `"Direction ("` -- assim toda a lógica
  que já dependia de `findSliderControl` (Copy, Remove, o próprio
  picker) continua achando o slider certo sem precisar saber que ele foi
  renomeado.
- **Testado ao vivo**: depois do Add, o slider já nasce como
  `Direction (Left to Right)`; troquei pra Random pelo `setTextRevealDirection`
  de verdade (nome virou `Direction (Random)`); simulei o usuário editando
  o valor cru pra `3` e resetando o nome pra `Direction` puro (bypassando
  o painel de propósito); chamei `readTextRevealDirection` (o que o poll
  de 700ms chama sozinho) e o nome se autocorrigiu pra
  `Direction (Center Out)` -- confirmando que o self-heal funciona mesmo
  quando a edição não passa pelo painel nenhuma vez.

## Changelog -- bug real: renomear o slider quebrou a expressão do reveal

O usuário reportou um erro de expressão de verdade no projeto dele logo
depois da mudança acima -- `effect("Direction")("Slider")`, usado em
`buildRevealExpression`, para de achar o efeito assim que o nome dele
deixa de ser exatamente `"Direction"` (a expressão `effect("nome")` do AE
casa pelo nome **atual** exibido, não pelo nome de quando a expressão foi
escrita). Corrigido em duas rodadas, as duas confirmadas ao vivo antes de
ficar pronto:

- **Primeira tentativa**: trocar `effect("Direction")` por um loop manual
  em `thisLayer.property("ADBE Effect Parade")`, igual o `findSliderControl`
  já faz do lado do scripting. Testei ao vivo -- deu erro novo:
  `TypeError: thisLayer.property is not a function`. **`thisLayer` dentro
  da expressão do `Amount` de um Expressible Selector não é o mesmo tipo
  de objeto Layer do lado de scripting** -- não tem `.property()` (nem
  `.Effects`, testado antes e também não existe aí). Achado direto ao
  vivo, não documentado em lugar nenhum que eu tenha visto.
- **Segunda tentativa (a que ficou)**: `effect(i)` com índice numérico
  **funciona** nesse mesmo contexto (é assim que Duration/From
  Index/Random Seed já eram lidos, só que por nome em vez de índice) --
  então o loop agora itera `effect(1)`, `effect(2)`, ... até 20, com
  `try/catch` em volta de cada tentativa (um índice fora do intervalo
  lança erro, capturado e usado como sinal de "acabaram os efeitos"), até
  achar o primeiro cujo `.name` seja `"Direction"` ou comece com
  `"Direction ("`. Confirmado sem `expressionError` nas 6 direções.
- **`readTextRevealDirection` ganhou uma reparação automática**: se o
  `expressionError` da propriedade `Amount` não estiver vazio quando essa
  função roda (chamada a cada poll de 700ms enquanto uma camada com a
  animação está selecionada), ela reaplica `buildRevealExpression()` na
  hora. Isso conserta sozinha qualquer camada que ficou com a versão
  quebrada da expressão (como a do usuário) só de selecionar a camada com
  o painel aberto -- não precisa reaplicar Add/Paste manualmente.

## Changelog -- Character Reveal organizado em seções (Timing / Transform)

O usuário mandou prints do painel de referência do TextEvo2, que separa
os parâmetros em seções dobráveis ("Transform", "Style") dentro do
próprio Effect Controls do AE, e pediu pra organizar o nosso do mesmo
jeito -- incluindo tentar de novo o dropdown de Direction dentro do
Effect Controls, já que o TextEvo2 consegue.

- **Confirmado ao vivo que nenhum dos dois é possível por script**:
  além do Dropdown Menu Control (já documentado acima), testei
  `ADBE Group` e mais 5 variações de nome (`ADBE Effect Group`,
  `ADBE Layer Effects`, `ADBE Group Control`, `ADBE Group Layer`,
  `"Group"`) tentando criar uma seção dobrável nativa no Effect Parade --
  todas falham com `Can not add a property with name "X" to this
  PropertyGroup`. Isso confirma que as seções "Transform"/"Style" do
  TextEvo2 também são desenhadas pelo plugin compilado deles (SDK de
  efeitos em C++), não uma funcionalidade do AE disponível via
  ExtendScript -- mesma categoria de limitação do dropdown, não uma
  questão de esforço/código.
- **A organização em seções foi construída no lado do painel
  (`client/`) em vez do Effect Controls**, já que é onde temos controle
  de verdade sobre como agrupar/dobrar coisas. Duas seções novas dentro
  de Character Reveal, reaproveitando o componente de linha numérica com
  arraste (`buildValueRow`) que Layer Transform e Shape Properties já
  usam -- mesmo visual, mesmo comportamento de arrastar/digitar/
  keyframe em todo o painel:
  - **Timing**: Duration, From Index, Random Seed.
  - **Transform**: Position Offset, Scale Start, Rotation Start.
  - O seletor de Direction (já existente) ficou entre as duas, antes de
    Timing -- ele não é um valor contínuo então não faz sentido no
    mesmo formato de campo arrastável.
- **`host.jsx` ganhou um mecanismo genérico** em vez de uma função por
  parâmetro: `TEXT_PARAM_MAP` liga uma chave curta (`"duration"`,
  `"positionOffset"` etc.) ao nome real do slider, e três funções cobrem
  todos os 6 parâmetros numéricos: `readTextRevealParams` (substituiu
  `readTextRevealDirection`, agora devolve `{values, animated,
  keyedNow}` de cada um, no mesmo formato que `updateTransformValues`
  já espera), `setTextRevealParam(key, value)` (substituiu
  `setTextRevealDirection`) e `toggleTextRevealParamStopwatch(key)`
  (nova -- liga/desliga keyframe num parâmetro, mesma lógica de
  `toggleTransformStopwatch` já usada em Layer Transform).
- **Testado ao vivo, ciclo completo**: cliquei Add de verdade e conferi
  os 6 campos aparecerem com os valores padrão certos; digitei um valor
  novo (`25`) no campo de Position Offset via double-click simulado (o
  mesmo fluxo que um clique duplo de usuário dispara) e confirmei que o
  slider real no Effect Controls mudou pra `25`; cliquei o cronômetro de
  Position Offset e confirmei que criou um keyframe de verdade
  (`numKeys` foi de 0 pra 1) com a classe visual `is-animated`/
  `is-keyed` aplicada; cliquei Remove e confirmei que todos os campos
  (inclusive o seletor de Direction) voltam a ficar desabilitados.

## Changelog -- divisores de texto no Effect Controls (Timing / Transform)

Depois da reorganização acima, o usuário esclareceu que não queria o
visual do painel replicado dentro do Effect Controls -- só queria os
sliders lá organizados de um jeito fácil de escanear, mesmo sem abrir o
painel. Como seções dobráveis de verdade são confirmadamente impossíveis
via script (changelog anterior), a alternativa que sobra é uma divisão
puramente visual dentro da própria lista plana de efeitos:

- **`ADBE Checkbox Control` renomeado funciona como divisor de texto**
  -- testei ao vivo criar um com nome `"── Transform ──"` (usando os
  travessões Unicode de verdade, não hífen), e o AE aceita qualquer nome
  para esse tipo de controle. O checkbox em si nunca é lido nem escrito
  por nada (`canSetEnabled` é `false`, então nem dá pra escondê-lo, mas
  isso não atrapalha o objetivo -- é só uma linha extra com o nome
  servindo de título de seção).
- **`host/host.jsx`**: `ensureDividerControl`/`findDividerControl`
  (mesmo padrão de `ensureSliderControl`/`findSliderControl`, só que
  filtrando por `matchName === "ADBE Checkbox Control"`). Dois nomes
  fixos, `TEXT_TIMING_DIVIDER_NAME` (`"── Timing ──"`) e
  `TEXT_TRANSFORM_DIVIDER_NAME` (`"── Transform ──"`), inseridos na
  ordem certa em `addTextAnimation` e `pasteTextAnimation` -- um antes
  de Duration, outro antes de Position Offset -- e removidos junto com
  os sliders em `removeTextAnimation` (`TEXT_DIVIDER_NAMES`, mesmo loop
  de limpeza).
- **Testado ao vivo**: depois do Add, o Effect Parade real fica na ordem
  `── Timing ── / Duration / Direction (X) / From Index / Random Seed /
  ── Transform ── / Position Offset / Scale Start / Rotation Start` (9
  propriedades, confirmado lendo `.name`/`.matchName` de cada uma direto
  no AE). Remove zera pra 0 propriedades (limpa sliders e os dois
  divisores). Paste sozinho recria a mesma ordem de 9 propriedades a
  partir de um clipboard só com os valores, sem os divisores -- eles são
  recriados do zero a cada Paste, não fazem parte do que é copiado (não
  há nada pra copiar num controle decorativo).

## Changelog -- revertido: divisores no Effect Controls + campos Timing/Transform no painel

As duas mudanças anteriores (divisores de texto no Effect Controls e as
seções Timing/Transform dentro do painel) foram revertidas -- o usuário
esclareceu que não queria o visual do painel replicado dentro do Effect
Controls, só os sliders organizados de um jeito simples de escanear, e
que os divisores viraram mais bagunça do que ajuda: cada `ADBE Checkbox
Control` renomeado aparece como sua própria linha `fx` com link "Reset"
e ícone de checkbox, então "── Timing ──" e "── Transform ──" liam como
mais dois títulos grandes no meio da lista, não uma separação discreta.

- **`host/host.jsx`**: removidos `ensureDividerControl`,
  `findDividerControl`, `TEXT_TIMING_DIVIDER_NAME`,
  `TEXT_TRANSFORM_DIVIDER_NAME`, `TEXT_DIVIDER_NAMES`, e as chamadas
  correspondentes em `addTextAnimation`/`pasteTextAnimation`/
  `removeTextAnimation`. O mecanismo genérico `TEXT_PARAM_MAP`/
  `readTextRevealParams`/`setTextRevealParam`/
  `toggleTextRevealParamStopwatch` (que existia só pra alimentar os
  campos Timing/Transform do painel) também foi removido, voltando pras
  funções específicas de Direction de antes:
  `readTextRevealDirection`/`setTextRevealDirection`.
- **`client/index.html` + `client/panel.js`**: removidas as seções
  "Timing"/"Transform" do painel (containers, `buildTextRevealFieldRow`,
  `setTextRevealRowsEnabled`, `updateTextRevealRows`, os arrays
  `TEXT_TIMING_SPEC`/`TEXT_TRANSFORM_SPEC`). O seletor de Direction por
  clique continua exatamente como estava -- é a única coisa dessa
  sequência de mudanças que o usuário confirmou gostar.
- **Estado final**: Effect Controls volta a ser uma lista plana de 7
  sliders (`Duration`, `Direction (X)`, `From Index`, `Random Seed`,
  `Position Offset`, `Scale Start`, `Rotation Start`), sem nenhum
  divisor. O painel mostra só o seletor de Direction, sem os campos
  numéricos extras. Testado ao vivo depois da reversão: Add cria as 7
  propriedades na ordem certa, sem controles decorativos; o seletor de
  Direction continua funcionando (`Left to Right` aparecendo certo logo
  depois do Add).

## Changelog -- ponto âncora agora considera máscaras

O usuário reportou que os botões de ponto âncora (a grade de 9 pontos)
ignoravam máscaras, movendo o âncora só com base na dimensão bruta da
camada -- exatamente o comportamento já anotado na seção "Sobre a
ferramenta nativa 'Quick Set Anchor'" acima, como diferença entre este
painel e a versão beta nativa do AE.

- **Confirmado ao vivo, não só lido**: criei um solid de teste 300x300
  com uma máscara bem menor (100x100, de (50,50) a (150,150), modo Add)
  e chamei `layer.sourceRectAtTime(time, extents)` com `extents` `true`
  e `false` -- **as duas formas devolvem o retângulo cheio de 300x300,
  ignorando a máscara por completo**. Ou seja, o parâmetro `extents` não
  resolve isso (ele é sobre efeitos que aumentam a área, não sobre
  máscaras que recortam) -- não tem como pedir pro AE calcular isso
  puramente com esse método.
- **Solução**: `maskAwareSourceRect(layer, rect)`, nova função em
  `host/host.jsx`, calcula o bounding box das próprias máscaras (lendo
  os vértices de `"ADBE Mask Shape"` de cada uma) e cruza esse box com o
  `sourceRectAtTime` original -- uma máscara só pode encolher a área
  visível aqui, nunca aumentar além da camada de verdade. Só entram na
  conta máscaras em modo Add/Intersect/Lighten/Darken -- None não
  contribui nada, e Subtract/Difference descrevem um buraco recortado
  da região, não a região em si, então incluir os vértices deles no
  cálculo aumentaria o box errado em vez de encolher. Com mais de uma
  máscara contribuindo, isso vira uma união simples dos retângulos de
  cada uma (não uma união booleana de verdade das formas) -- resolve bem
  o caso comum (uma máscara só), mas camadas com várias máscaras
  sobrepostas de formato estranho ainda podem sair um pouco erradas.
- `applyAnchorPresetToLayer` passou a chamar
  `maskAwareSourceRect(layer, layer.sourceRectAtTime(comp.time, false))`
  em vez de usar o retângulo bruto direto.
- **Testado ao vivo**: com a máscara de teste acima, cliquei (via
  `setAnchorPreset`) no preset de centro -- o ponto âncora foi pra
  `[100, 100, 0]`, o centro real da máscara (50 a 150 nos dois eixos),
  não o centro do solid inteiro (que seria `[150, 150, 0]`).

## Changelog -- aba Kit (layout inicial) com o primeiro preset

Nova terceira aba de página, "Kit", pra guardar presets prontos de
animação organizados por categoria, com prévia visual de cada um antes
de aplicar.

- **Layout**: `client/index.html` ganhou `#page-kit`, dividido em
  `.kit-categories` (lista vertical à esquerda, com borda direita
  servindo de divisória) e `.kit-presets` (grade de telinhas à direita).
  A aba em si (`#page-tab-kit`) usa o mesmo mecanismo de troca de página
  que Home/Text já tinham (`initPageTabs` em `client/panel.js` já era
  genérico o bastante pra funcionar com uma terceira aba sem mudança
  nenhuma).
- **Categorias combinadas**: `Text reveal`, `Shapes`, `Composition`,
  `Effects` (`KIT_CATEGORIES` em `client/panel.js`). Clicar numa
  categoria filtra a grade -- sem categoria com preset nenhum ainda
  mostra "No presets in this category yet." em vez de ficar vazio sem
  explicação.
- **Prévia sem depender do After Effects**: cada preset tem uma
  animação CSS pequena, em loop, dentro da própria telinha
  (`.kit-swatch` + uma classe de animação por preset, ex.
  `.kit-anim-fade-in`) -- não é possível prever o render real do AE
  de dentro do painel, então isso é só uma representação visual do
  "jeitão" do efeito, pra dar uma ideia antes de clicar.
- **Primeiro preset**: `text-fade-in` ("Fade In", categoria Text
  reveal) -- fade de Opacity 0% a 100% ao longo de 1 segundo a partir do
  `inPoint` da camada. É um fade de Opacity da camada inteira (Transform
  normal), não o mecanismo de Text Animator por caractere do Character
  Reveal -- proposital, já que presets do Kit valem pra qualquer tipo de
  camada, não só texto.
- **`host/host.jsx`**: `applyKitPreset(id)` -- um dispatcher genérico
  (`KIT_PRESET_HANDLERS`, um objeto id -> função) em vez de uma função
  exportada por preset, já que todo preset compartilha a mesma forma
  (aplicar em cada camada selecionada, dentro de um undo group). Cada
  preset novo precisa de uma entrada aqui E uma em `KIT_PRESETS` do lado
  do painel (label, categoria, classe de CSS da prévia).
- **Testado ao vivo**: cliquei a aba Kit de verdade, confirmei as 4
  categorias e a telinha "Fade In" aparecendo; cliquei numa categoria
  vazia (Shapes) e confirmei a mensagem de "sem presets"; numa camada de
  texto de teste, cliquei a telinha Fade In de verdade e confirmei 2
  keyframes de Opacity (`0% em t=0`, `100% em t=1`) no Effect Controls
  real.

## Changelog -- divisória do Kit arrastável

A borda fixa entre a lista de categorias e a grade de presets virou uma
barra arrastável de verdade (`#kit-resizer`), redimensionando a lista à
esquerda enquanto a grade (que já era `flex: 1`) preenche o espaço que
sobra sozinha.

- **`client/panel.js`**: `initKitResizer()` -- arraste via
  `pointerdown`/`pointermove`/`pointerup` com `setPointerCapture` (mesmo
  padrão de arraste usado em `bindNumericInput` no resto do painel),
  limitado entre 64px e 200px (`KIT_RAIL_MIN`/`KIT_RAIL_MAX`). O valor
  fica salvo no `localStorage` (`motionfilm-kit-rail-width`) e volta
  sozinho na próxima vez que o painel abrir. Também dá pra ajustar pelo
  teclado (setas esquerda/direita, 8px por vez) já que o elemento tem
  `role="separator"` com `tabindex`.
- **`client/styles.css`**: a borda fixa que antes vivia em
  `.kit-categories` virou a própria barra -- `.kit-resizer` é um
  elemento de 9px de largura (área de clique generosa) com uma linha
  fina de 1px desenhada no centro via `::after`, que engrossa e fica na
  cor de destaque durante o arraste ou ao passar o mouse.
- **Testado ao vivo**: arrastei o resizer 40px pra direita a partir dos
  92px iniciais -- a lista foi pra 132px, exatamente como esperado, e o
  valor apareceu salvo no `localStorage` na hora. Recarreguei o painel e
  confirmei que os 132px voltaram sozinhos. Arrastei bem além do limite
  (500px) e confirmou que trava em 200px, não passa daí.

## Changelog -- campos numéricos pareados (Text) somem em painel estreito

O usuário reportou que, com o painel estreito, o segundo número de
linhas com dois campos (Font Size + Escala Vertical, Kerning + Tracking)
sumia -- pedindo pra ficar mais perto do ícone em vez de desaparecer.

- **Causa confirmada ao vivo**: `.tx-split-controls` usava
  `justify-content: space-between`, empurrando o segundo par
  ícone+campo pra borda direita do container flex -- só que essa "borda"
  é medida contra a caixa do container, não o que está de fato visível.
  Numa largura de 280px (o `MinSize` real do painel, definido no
  `CSXS/manifest.xml`), medi o campo da direita renderizando com
  `left: 299px` pra fora de um `body` de 280px de largura -- sem barra de
  rolagem horizontal pra alcançar, ele simplesmente nunca aparece.
- **Descoberta lateral sobre como testar isso**: só mudar
  `document.body.style.width` não é suficiente pra disparar
  `@media (max-width: ...)` -- media queries reagem ao **viewport** de
  verdade, não a um elemento redimensionado por CSS. O jeito certo de
  simular um painel estreito de verdade é `Emulation.
  setDeviceMetricsOverride` via CDP bruto -- só depois de usar isso o
  breakpoint de 320px realmente ativou durante o teste.
- **Correção**: `.tx-split-controls` trocou `space-between` por
  `flex-start` com `gap: 14px` -- o segundo par fica sempre logo depois
  do primeiro, nunca mais flutuando solto até a borda do container. Os
  campos dentro desses pares também ficaram mais estreitos (60px em vez
  de 88px, e mais um passo pra 52px dentro do breakpoint de 320px).
  Abaixo de 320px, `.tx-split-controls` ganhou `flex-wrap: wrap` -- se
  mesmo assim não couber os dois pares numa linha só, o segundo quebra
  pra uma segunda linha (a linha só fica um pouco mais alta) em vez de
  ficar invisível.
- **Testado ao vivo nos dois extremos**: com o viewport emulado em
  280px (mínimo real), os dois campos de cada linha quebraram em duas
  linhas, ambos com `right` dentro dos 280px visíveis. Com o viewport em
  360px (largura padrão), os dois ficaram lado a lado na mesma linha,
  mais próximos um do outro que antes, também dentro da área visível.

## Changelog -- aba "Icons" (importação de SVG via internet)

Nova aba ao lado de Kit, pra buscar e importar ícones SVG de licença aberta
direto pra dentro do projeto do After Effects, sem precisar abrir o
navegador e baixar manualmente. Depende de internet (decisão explícita do
usuário, ciente da dependência).

- **Fonte dos ícones**: API pública da Iconify (`api.iconify.design`), sem
  chave, agregando mais de 150 sets de ícones abertos (Material Symbols,
  Tabler, Phosphor, Feather etc., todos MIT/Apache-2.0/CC-BY/OFL).
  `/search?query=X&limit=64` devolve os nomes (`"prefix:name"`) em JSON;
  `/{prefix}/{name}.svg?color=%23HEX` devolve o SVG já recolorido pro preview
  na grade; `/{prefix}/{name}.svg` (sem `color`) devolve o SVG original
  (`fill="currentColor"`) que é o que de fato importamos.
- **`client/index.html`**: aba nova `#page-icons` com campo de busca
  (`#icons-search`), texto de aviso sobre a dependência de internet, e uma
  grade (`#icons-grid`) que recebe as telinhas de resultado.
- **`client/panel.js`**: `initIconsTools()` liga um `input` debounced
  (400ms) no campo de busca a `runIconSearch()`, que busca na Iconify e
  chama `renderIconsGrid()`. Cada telinha, ao clicar, chama `importIcon()`:
  baixa o SVG original via `fetch`, manda o texto puro pro lado do
  ExtendScript via `hostCall("importSvgIcon", [svgText, fullName], ...)`, e
  mostra sucesso/erro na barra de status do painel. Um `token` incremental
  em `runIconSearch` garante que uma busca antiga que ainda está voltando da
  rede não sobrescreva o resultado de uma busca mais nova.
- **`host/host.jsx`**: `importSvgIcon(svgText, name)` -- salva o SVG recebido
  como arquivo de verdade em `Documents/Mótion Film Icons/`, importa como
  `ImportOptions` (footage comum, não Shape Layer editável -- decisão restrita
  do usuário: mais simples e robusto que tentar parsear o SVG em formas
  nativas do AE) e adiciona a camada na composição ativa, tudo dentro de um
  único undo group.
- **Bug real encontrado e corrigido ao vivo**: nomes de ícone da Iconify são
  sempre `"prefix:nome"` (ex.: `"material-symbols:star"`). A sanitização
  inicial de nome de arquivo (`safeName`) deixava o `:` passar direto pro
  nome do arquivo -- só que `:` é caractere reservado no Windows (posição de
  letra de unidade / NTFS Alternate Data Stream). Resultado ao vivo: o AE
  reportava sucesso, a camada e o `sourceFile` apareciam com o caminho
  contendo `:`, mas `folder.getFiles("*.svg")` na mesma pasta voltava uma
  lista **vazia** -- o `File.write()` do ExtendScript não deu erro, mas
  quase certamente escreveu num stream de dados alternativo oculto em vez de
  um arquivo `.svg` de verdade. Corrigido trocando todo `:` por `-` antes de
  aplicar a lista de caracteres permitidos (`material-symbols:star` vira
  `material-symbols-star.svg`).
- **Testado ao vivo (antes e depois da correção)**: busquei "star" na aba
  Icons, cliquei a primeira telinha (`material-symbols:star`), e confirmei
  status de sucesso nas duas rodadas. Antes da correção,
  `folder.getFiles("*.svg")` voltava `[]` apesar do layer/fonte reportarem
  sucesso -- inconsistência real, não só cosmética. Depois da correção,
  reload de `host.jsx` a quente via `$.evalFile`, repeti a mesma busca e
  importação: `sourceFile` agora aponta pra
  `...\Mótion Film Icons\material-symbols-star.svg` (sem `:`) e
  `folder.getFiles("*.svg")` retorna exatamente `["material-symbols-star.svg"]`
  -- arquivo real confirmado em disco, consistente com o que o AE reporta.
- **Limitação conhecida, aceita pelo usuário**: precisa de internet pra
  buscar e baixar; sem conexão, a busca mostra uma mensagem de erro amigável
  em vez de travar.

## Changelog -- ícone importado ficava invisível (fill="currentColor")

O usuário reportou que, depois de importar um ícone, a camada aparecia no
projeto (bounding box certinho, visível na grade de 9 pontos do ponto
âncora) mas nenhum traço do ícone em si aparecia no monitor, mesmo
aumentando muito a escala.

- **Causa confirmada ao vivo**: a implementação original buscava o SVG
  "sem cor" da Iconify pra importação (`fill="currentColor"` nos paths),
  de propósito, pra não travar o ícone importado na cor de destaque do
  painel. Só que `currentColor` só resolve pra algo visível dentro de uma
  cascata CSS de navegador -- o importador de SVG do próprio After Effects
  não entende essa palavra-chave e não cai pra nenhuma cor padrão (nem
  preto): o preenchimento simplesmente não resolve pra nada. Confirmado
  lendo de volta o `.svg` salvo em disco depois de importar: continha
  `currentColor` mesmo, sem nenhum `fill` explícito.
- **Correção**: a busca de importação agora usa o mesmo parâmetro `?color=`
  que a Iconify já aceita, igual o preview já fazia -- só que com um valor
  fixo (`#ffffff`, branco) em vez da cor de destaque do painel. Branco é um
  ponto de partida neutro pra motion design (fácil de recolorir depois com
  um efeito Fill). `iconRawUrl` virou `iconImportUrl` em `client/panel.js`.
- **Testado ao vivo**: reimportei "material-symbols:star" depois da
  correção e li o `.svg` salvo em disco de volta -- confirmado
  `currentColor` ausente e `#ffffff` presente no `fill`. Ícones
  importados antes da correção (ex.: os testados pelo próprio usuário)
  continuam com o bug -- é só reimportar pra corrigir, não precisa de
  nenhuma migração automática.

## Changelog -- ícone importado vinha minúsculo (width/height="1em")

Junto com o bug de cor acima, o usuário reportou que a camada importada
vinha num tamanho minúsculo -- precisando de ~471740% de escala pra
ficar "normal", e mesmo assim continuava invisível (esse segundo sintoma
era o bug de cor acima, simultâneo).

- **Causa confirmada ao vivo**: o SVG que a Iconify manda por padrão tem
  `width="1em" height="1em"` -- unidade que só resolve contra o
  `font-size` de um elemento CSS de verdade, algo que não existe no
  contexto do importador de SVG do After Effects. Confirmado lendo a
  camada de teste real do usuário (`mingcute-star-fill.svg`, já no
  projeto dele): `layer.source.width`/`height` vinham como `1`/`1` --
  o AE literalmente tratou `1em` como "1" (unidade genérica, não
  pixels de verdade), dando uma fonte de 1x1px que precisa de dezenas de
  milhares de por cento de escala só pra virar um ícone do tamanho normal
  de uma tela.
- **Correção**: a Iconify aceita um parâmetro `height` (ou `width`) na
  mesma URL do SVG, que grava um valor numérico fixo ali no lugar de
  `1em` -- sem tocar no `viewBox` nem nos paths (testado via `curl`
  comparando os dois SVGs byte a byte fora do `width`/`height`: só essa
  metadata muda, o desenho em si continua vetorial e idêntico). A URL de
  importação (`iconImportUrl` em `client/panel.js`) agora pede
  `&height=512` -- um tamanho generoso o bastante pra não precisar de
  escala nenhuma na maioria dos casos, sem custo de qualidade porque
  continua sendo vetor, não um raster de 512px de verdade.
- **Testado ao vivo**: reimportei "material-symbols:star" com a correção
  e confirmei o `.svg` salvo com `width="512" height="512"` (mantendo o
  mesmo `viewBox="0 0 24 24"` de antes), e a camada nova no AE reportando
  `layer.source.width/height` = 512/512 com `Scale` em 100/100/100 --
  tamanho normal, sem precisar ajustar nada na mão.
- **Nota**: a camada `mingcute-star-fill.svg` que o próprio usuário já
  tinha no projeto continua com o bug antigo (1x1px + escala manual) --
  não foi automaticamente migrada. Basta apagar essa camada e reimportar
  o mesmo ícone pela aba Icons pra vir corrigido.

## Changelog -- ícone perde qualidade ao aumentar a escala

Depois dos dois bugs acima corrigidos, o usuário reportou que a camada
importada não se comporta como vetor -- aumentando a escala, o ícone vai
perdendo nitidez/qualidade, igual aconteceria com um PNG.

- **Causa**: `comp.layers.add(footageItem)` cria a camada, mas isso
  sozinho não liga o interruptor de "Continuously Rasterize" (mesma
  propriedade de script que "Collapse Transformation" em pré-comps) --
  sem ele, o AE rasteriza a arte vetorial **uma vez**, no tamanho de
  importação, e depois só estica esse raster fixo conforme a escala
  muda, exatamente como uma imagem comum.
- **Correção**: `importSvgIcon` em `host/host.jsx` agora guarda a
  referência da camada recém-criada e liga
  `newLayer.collapseTransformation = true` logo em seguida (dentro de um
  `try/catch` isolado -- se por algum motivo a propriedade não existir
  pra um tipo de footage específico, o ícone continua importado
  normalmente, só sem o benefício extra).
- **Testado ao vivo**: reimportei um ícone numa composição de teste
  isolada e li `layer.collapseTransformation` de volta -- veio `true`,
  sem exceção nenhuma lançada. Confirma que a propriedade é aceita nesse
  tipo de footage nesta versão do AE (26.3x87); a verificação visual de
  nitidez em si (zoom no viewer do AE em alta escala) fica por conta do
  usuário, já que a ponte de debug remoto só alcança o painel CEP, não a
  interface nativa do After Effects.

## Changelog -- ícones organizados numa pasta única do painel Project

A pedido do usuário, os ícones importados agora vão parar dentro de uma
pasta (`FolderItem`) chamada "Motion_Film_Icons" no painel Project do AE,
em vez de soltos na raiz do projeto -- a pasta é criada só uma vez, no
primeiro import, e reaproveitada em todos os imports seguintes.

- **`host/host.jsx`**: `findOrCreateIconsProjectFolder()` -- percorre
  `app.project.item(i)` procurando um `FolderItem` já existente com esse
  nome; se não achar, cria com `app.project.items.addFolder(...)`.
  `importSvgIcon` chama isso logo depois do `importFile` e atribui
  `footageItem.parentFolder = ...` antes de adicionar a camada na
  composição.
- **Nota**: isso é só organização dentro do painel Project do AE (um
  conceito só do projeto `.aep`) -- não tem relação com a pasta
  `Documents/Mótion Film Icons` no disco, que continua guardando os
  arquivos `.svg` de origem de cada footage (necessário pro AE conseguir
  reler o arquivo depois).
- **Testado ao vivo**: importei dois ícones diferentes ("star" e "play")
  em sequência numa composição de teste -- confirmei exatamente **uma**
  pasta "Motion_Film_Icons" no projeto (não duas), com os dois footage
  items dentro dela.

## Changelog -- mais variedade de ícones (pesquisa de fontes + fallback de termos)

O usuário perguntou se dava pra somar outros sites ao Iconify pra ter mais
variedade, especificamente pra ícones de conceito/profissão (ex.:
"attorney" não retornava nada), não só de interface.

- **Pesquisa de fontes alternativas**: o Iconify já não é "um site", é um
  agregador de **474 bibliotecas de ícones abertas** (confirmado ao vivo
  via `/collections`), quase 336 mil ícones ao todo -- uma busca só por
  "heart" já retornou ícones de 31 famílias diferentes misturadas.
  Mesmo assim, testei duas fontes específicas pra ícones mais temáticos/
  de conceito (não só interface):
  - **Openclipart** (domínio público, ótimo pra esse tipo de conceito) --
    a API pública JSON está **fora do ar** (`/search/json/?query=...`
    hoje só redireciona pra home page do site, confirmado com `curl -L`).
    Não dá pra integrar.
  - **The Noun Project** -- tem cobertura real de ícones de profissão/
    conceito, mas o modelo mudou: hoje é só um **teste grátis de 30
    dias** (não um plano gratuito permanente), com planos pagos depois
    disso (mínimo $25/mês, ou $0,0025-$0,0095 por ícone). Confirmado
    direto na página oficial (`thenounproject.com/api/`). Como o usuário
    pediu explicitamente nenhum limite na ferramenta, essa opção foi
    descartada -- não é consistente com o resto da extensão (Iconify é
    sempre grátis, sem chave, sem prazo).
- **Decisão**: em vez de integrar uma fonte com prazo/custo, melhorar a
  busca dentro do próprio Iconify pra achar melhor o que já existe lá.
- **`client/panel.js`**: testei ao vivo contra a API real ~35 palavras de
  profissão comuns em inglês; 11 delas retornavam **zero** resultados
  mesmo o conceito existindo lá sob outro nome (`attorney`, `physician`,
  `professor`, `policeman`, `salesman`, `journalist`, `photographer`,
  `athlete`, `surgeon`, `veterinarian`, `secretary`) -- confirmado que
  termos relacionados (`law`, `doctor`, `teacher`, `police`, `sales`,
  `news`, `camera`, `sports`, `surgery`, `vet`, `assistant`) têm ótima
  cobertura. `ICON_SEARCH_FALLBACK_TERMS` é esse mapeamento
  (pequeno, verificado à mão -- não é um motor de sinônimos genérico).
  `runIconSearch` agora: busca o termo digitado; se vier vazio E o termo
  bate com uma entrada do mapa, busca de novo com o termo alternativo e
  mostra os resultados com um aviso visível (`.icons-note`) explicando a
  substituição -- nunca troca o termo silenciosamente. Se vier vazio sem
  mapeamento, a mensagem de "nada encontrado" agora sugere tentar um
  termo mais genérico em vez de só dizer "No icons found."
- **Testado ao vivo**: busquei "attorney" no painel real -- confirmei a
  nota `"No icons named "attorney" -- showing results for "law"
  instead."` e 64 ícones de balança/martelo de juiz na grade. Busquei um
  termo inventado sem mapeamento -- confirmei a mensagem de "nada
  encontrado" nova, sem nota de substituição (comportamento correto pros
  dois casos).

## Changelog -- busca sempre mostrava a mesma quantidade e não dava pra rolar

O usuário reportou que a grade de ícones sempre mostrava a mesma
quantidade de resultados, independente do termo buscado, e não dava pra
rolar pra baixo pra ver mais.

- **Causa raiz confirmada ao vivo**: a busca tinha `&limit=64` fixo na URL
  e nunca pedia mais -- "house", por exemplo, tem 689 resultados reais no
  Iconify, mas a extensão só buscava (e mostrava) os 64 primeiros, sempre.
  Como quase toda palavra comum ultrapassa 64 resultados, a grade parecia
  sempre ter "a mesma quantidade" -- e como não sobrava nada além desses
  64 já carregados, não tinha mesmo pra onde rolar (não era um bug de
  CSS/rolagem quebrada, e sim de nunca buscar mais do que a primeira
  leva).
- **Armadilha real encontrada ao tentar corrigir com paginação de
  servidor**: a primeira tentativa foi paginar via requisições repetidas
  (`&start=N`), confiando no campo `total` da resposta do Iconify pra
  saber quando parar. Só que `total` **não é uma contagem estável** --
  testado ao vivo que a mesma busca por "house" retornava `total:64` com
  `limit=64`, `total:32` com `limit=10` e `total:689` só com `limit=999`.
  A API claramente para de contar assim que atinge o `limit` pedido, e
  `total` só reflete o que contou até aquele ponto -- não o total real do
  índice inteiro. Paginar confiando nesse campo nunca ia funcionar direito
  (a primeira leva sempre reportava `total` igual ao que já tinha vindo,
  fazendo o código pensar que já tinha tudo).
- **Correção final**: em vez de paginar via múltiplas chamadas de rede,
  `client/panel.js` agora faz **uma única busca por termo**, com
  `&limit=999` (o teto documentado do Iconify), guarda a lista completa
  de nomes em memória (`iconsSearchState.allNames`) e revela
  `ICONS_PAGE_SIZE` (64) por vez na grade conforme o usuário rola --
  fatiamento local do array, sem chamada de rede nova nenhuma. Um rodapé
  (`.icons-footer`) mostra "Showing 64 of 689 -- scroll for more" enquanto
  sobra alguma coisa; some sozinho quando tudo já foi revelado.
  `fillIconsGridIfNotScrollable()` cobre o caso de um resultado pequeno
  (ou um painel muito alto) onde a primeira leva já nem chega a
  transbordar a grade -- nesse caso ela revela páginas extras sozinha, sem
  esperar rolagem nenhuma, até sobrar overflow de verdade ou a lista
  acabar.
- **Testado ao vivo**: busquei "house" -- confirmei 64 ícones + rodapé
  "Showing 64 of 689 -- scroll for more" na primeira leva; simulando
  rolagem repetida até o fim, confirmei os 689 ícones completos na grade e
  o rodapé sumindo (nada mais restando). Testei também o caminho de
  substituição de termo ("veterinarian" → "vet", 15 ícones, sem rodapé
  restante) e um termo com poucos resultados diretos ("waiter", 3 ícones)
  -- ambos revelam tudo automaticamente sem travar, sem loop infinito.

## Changelog -- scrollbar da grade de ícones sem estilo próprio

A grade de ícones usava a scrollbar padrão do sistema (grossa, cinza
claro) em vez do visual fino já usado em `main` nas abas Home/Text.

- **`client/styles.css`**: `.icons-grid::-webkit-scrollbar`/`-thumb` agora
  seguem o mesmo padrão de `main` (5px de largura, thumb
  `var(--panel-raised)` arredondado). Aproveitei pra aplicar o mesmo em
  `.kit-categories`/`.kit-presets` (aba Kit) também, que tinham o mesmo
  problema -- consistência visual em toda área com rolagem própria do
  painel, não só a que o usuário reportou.
- **Testado ao vivo**: screenshot real via CDP (`Page.captureScreenshot`)
  da grade de ícones rolada -- confirmado visualmente o thumb fino e
  discreto, sem a barra grossa clara de antes.

## Changelog -- aba "Captions" (transcrição de vídeo/áudio local)

Nova aba pra transcrever o áudio de uma camada de vídeo/áudio direto
dentro do After Effects, criando uma camada de texto por frase,
posicionada no ponto certo da timeline. Roda **inteiramente local**, sem
conta, sem chave de API, sem custo por uso, sem limite -- decisão
explícita do usuário depois de descartar as alternativas baseadas em
nuvem/serviço pago (ver "Pesquisa de fontes" abaixo).

- **A ferramenta**: [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
  (reimplementação em C++ do modelo Whisper da OpenAI, MIT license) +
  [ffmpeg](https://github.com/BtbN/FFmpeg-Builds) (LGPL) pra extrair/
  converter o áudio. Ambos rodam via `child_process` do Node.js, que já
  vem habilitado nesta extensão (`--enable-nodejs` no manifest). O modelo
  de linguagem escolhido foi "small" (~465MB) -- bom equilíbrio entre
  velocidade e precisão, escolhido pelo usuário entre 3 opções
  apresentadas (tiny/base/small).
- **Setup de primeira vez**: `client/panel.js` baixa os 3 componentes
  (`whisper-bin-x64.zip`, um build de ffmpeg, e o modelo `.bin`) via
  `https.get` do Node com acompanhamento de progresso real (barra +
  porcentagem), extrai os `.zip` via `Expand-Archive` do PowerShell
  (chamado como processo filho -- Node não tem descompactação de zip
  nativa), e salva tudo em `Documents/Mótion Film Tools/`. Depois da
  primeira vez, a aba já abre pronta pra usar, sem precisar de internet.
- **Pipeline de transcrição** (`transcribeSelectedLayer` em `panel.js`):
  1. `host.jsx`'s `getSelectedLayerAudioInfo()` pega o arquivo de origem
     da camada selecionada (`layer.source.mainSource.file`) e o
     `layer.startTime` (offset da camada na timeline da composição).
  2. `ffmpeg` converte esse arquivo pra WAV 16kHz mono (formato que o
     whisper exige).
  3. `whisper-cli.exe` transcreve com `-ojf` (JSON completo, com
     timestamp por token/palavra) e `-l auto` (detecção automática de
     idioma).
  4. `splitTranscriptIntoPhrases()` agrupa os tokens em frases, cortando
     a cada pontuação de fim de frase (`.`/`!`/`?`) -- mais fino que os
     "segmentos" que o próprio whisper devolve (que às vezes juntam
     várias frases num só bloco).
  5. `host.jsx`'s `createCaptionLayers()` cria uma camada de texto por
     frase, com `inPoint`/`outPoint` = tempo da frase + `layerStartTime`,
     texto centralizado na parte de baixo do quadro (`Position` em
     `[width/2, height*0.88]`, `Anchor Point` em `[0,0]`, justificação
     `CENTER_JUSTIFY`).
- **Bug real encontrado: `whisper-cli.exe` corrompe caminho com
  acento.** Confirmado ao vivo: o executável (compilado majoritariamente
  pra Linux/Mac, onde `argv` já vem em UTF-8) lê os próprios argumentos de
  linha de comando como se já viessem em UTF-8, mas o Windows entrega
  `argv` na codepage ANSI por padrão -- um caminho como
  `C:\Users\Usuário\...` (nome de usuário do Windows com acento) saía
  corrompido (`Usu\ufffdrio`), e o modelo falhava ao carregar. `ffmpeg`
  **não** tem esse bug (testado ao vivo lado a lado, mesmo caminho
  acentuado funcionou perfeito nele). Corrigido usando o **nome curto
  (8.3) do Windows** só nos argumentos passados pro whisper-cli.exe
  (`toShortPath()` em `panel.js`, via `cmd.exe /c "for %I in (...) do
  @echo %~sI"` -- um builtin do cmd, não um processo separado sujeito ao
  mesmo bug).
- **Bug real encontrado: `execFile` travava pra sempre.** Tanto
  `ffmpeg.exe` quanto `whisper-cli.exe`, nesse ambiente específico de
  Node embutido dentro do CEP, disparam o evento `exit` corretamente
  (confirmado ao vivo: ~50ms depois do processo realmente terminar), mas
  **nunca disparam o evento `close`** -- os pipes de stdio nunca sinalizam
  EOF mesmo com o processo já encerrado. Como o callback do
  `child_process.execFile` só dispara no `close`, ficava esperando pra
  sempre (só "resolvia" quando um timeout de teste matava o processo à
  força, e mesmo assim sem reportar erro). Corrigido reescrevendo
  `runCommand()` pra usar `spawn()` + evento `exit` (coletando
  stdout/stderr manualmente via streams) em vez de `execFile()`.
- **Bug real encontrado: tokens de metadado do whisper vazando pro
  texto.** `-ojf` liga timestamp por token, mas o token stream inclui
  marcadores internos tipo `[_BEG_]` e `[_TT_444]` misturados com as
  palavras de verdade. O filtro inicial (`/^\[_.*_\]$/`, exigindo `_]` no
  final) só pegava o formato `[_BEG_]` e deixava `[_TT_444]` vazar direto
  pro meio do texto da legenda. Corrigido generalizando pra qualquer coisa
  inteiramente entre colchetes (`/^\[.*\]$/`) -- fala de verdade nunca
  vem embrulhada em colchete.
- **`window.require`/`require` não são confiáveis neste CEP -- use
  `window.cep_node.require`.** Um teste isolado bem no início encontrou
  `window.require` funcionando, mas depois de alguns reloads do painel
  ele sumiu; o bridge que realmente funciona de forma consistente (testado
  repetidas vezes) é `window.cep_node.require`. `nodeRequire()` em
  `panel.js` tenta `cep_node.require` primeiro, com os outros como
  fallback.
- **Testado ao vivo, pipeline completo**: comp de teste com uma camada de
  áudio (fala gerada via TTS do Windows, sem depender de nenhum arquivo de
  terceiros) com `startTime = 2`. Clicando em "Transcribe Selected Layer"
  no painel real: 3 camadas de texto criadas em ~28 segundos, cada uma com
  `inPoint`/`outPoint` corretamente deslocados por esses 2 segundos, texto
  limpo (sem tokens de metadado), posicionadas centralizadas embaixo do
  quadro.

### Pesquisa de fontes (por que ficou 100% local)

O usuário perguntou por transcrição dentro do AE; a pesquisa considerou
alternativas antes de decidir por uma solução local:

- **APIs de nuvem** (OpenAI Whisper API, AssemblyAI, Google Speech-to-
  Text, Deepgram) -- todas exigem conta + chave de API e cobram por uso
  (nenhuma tem um plano "grátis pra sempre, sem limite" verdadeiro) --
  descartadas, já que o usuário deixou claro (na conversa sobre fontes de
  ícones) que não quer nada com limite na ferramenta.
- **whisper.cpp local** (a opção escolhida) -- roda inteiramente na CPU do
  usuário, sem internet depois do setup, sem custo, sem limite -- o único
  candidato que bate com o padrão já estabelecido pra essa extensão
  (mesmo espírito do Iconify: gratuito, sem chave, sem prazo).

### Limitações conhecidas

- Assume que a camada selecionada **não tem Time Remap** na sua fonte --
  o cálculo de tempo usa `layer.inPoint + tempo_da_frase_no_trecho
  extraído`, que é exato pro caso comum (camada sem remapeamento de
  tempo), mas pode ficar levemente errado numa camada com velocidade
  alterada.
- Precisão da transcrição depende inteiramente do modelo Whisper --
  sotaques fortes, ruído de fundo ou termos muito técnicos podem sair
  errados, igual qualquer transcrição automática. Cortar o áudio bem no
  meio de uma frase (ver "só a parte visível" abaixo) também pode fazer o
  Whisper "completar" a frase cortada com um palpite -- confirmado ao vivo
  num teste de corte no meio da fala.
- A pontuação de fim de frase que separa as legendas vem do próprio
  whisper -- se ele não colocar um ponto final onde deveria (comum em
  fala corrida sem pausa clara), duas frases podem sair juntas numa única
  camada.
- Em raras ocasiões o arquivo temporário `.wav`/`.json` de uma
  transcrição pode não ser apagado depois (ex.: o Windows ainda segurando
  o arquivo aberto no exato momento da limpeza) -- não afeta o resultado,
  só sobra um arquivo extra em `Documents/Mótion Film Tools/temp/` que
  pode ser apagado à mão sem problema.

## Changelog -- Captions: respeitar a duração da timeline + destaque visual das etapas

Três ajustes pedidos pelo usuário depois de testar a aba Captions pela
primeira vez.

- **Só transcrever a parte visível na timeline**: antes, a transcrição
  sempre lia o arquivo de origem inteiro, ignorando corte (In/Out) que o
  usuário tivesse feito na camada. `getSelectedLayerAudioInfo()` em
  `host.jsx` agora calcula `sourceInPoint`/`sourceOutPoint` (o trecho do
  arquivo de origem que corresponde ao que está de fato visível entre
  `layer.inPoint` e `layer.outPoint`, limitado também à duração da
  composição) e devolve isso pro painel. `runTranscriptionPipeline()` em
  `panel.js` passa esses dois valores como `-ss`/`-to` (opções de
  **entrada** do ffmpeg, antes do `-i`, relativas à timeline original do
  arquivo) -- só esse trecho é extraído e transcrito. Como o clipe
  extraído já começa exatamente onde a camada começa a aparecer, o cálculo
  de tempo das legendas também simplificou: `layer.inPoint +
  tempo_da_frase`, em vez do `layerStartTime + tempo_no_arquivo_inteiro`
  de antes.
  - **Testado ao vivo**: comp de teste com uma camada de 15,23s de áudio
    (4 frases faladas via TTS), recortada pra mostrar só os 30%-75% do
    meio (`inPoint=5.569s`, `outPoint=12.4225s` na timeline). A
    transcrição resultante trouxe só conteúdo desse meio (nada da
    primeira nem da última frase), com a primeira legenda começando
    exatamente em `5.569s` -- confirma que o corte e o realinhamento de
    tempo bateram certinho. Como esperado (ver "Limitações conhecidas"),
    cortar bem no meio de uma frase fez o Whisper "completar" o trecho
    cortado com uma frase parecida mas não idêntica ao áudio original --
    isso é uma limitação inerente de qualquer transcrição automática
    cortada no meio da fala, não um bug do corte em si.
- **Etapas mais visíveis**: o texto de status (“Extracting audio…”,
  “Transcribing…” etc.) usava a mesma classe cinza discreta
  (`.captions-hint`) dos parágrafos de instrução estáticos ao redor,
  ficando pouco destacado. Criada uma classe nova (`.captions-step-text`)
  só pra essa linha dinâmica -- cor de destaque do tema
  (`var(--accent-bright)`), fonte maior (12px) e negrito -- sem mexer no
  estilo dos textos de instrução fixos.
- **Spinner de carregamento**: um círculo giratório simples em CSS puro
  (`.captions-spinner`, borda colorida com a cor de destaque do tema,
  `@keyframes captionsSpin`) ao lado do texto de status, tanto na barra de
  progresso do setup quanto durante a transcrição em si.
  - **Testado ao vivo**: screenshot via CDP (`Page.captureScreenshot` com
    recorte/zoom) durante uma transcrição real em andamento -- confirmado
    visualmente o círculo girando e o texto grande/em negrito na cor de
    destaque (que no ambiente de teste está configurada como verde, já
    que a cor de destaque é customizável pelo usuário nas configurações
    do painel).

## Changelog -- modal de configurações da legenda (comprimento, preset, idioma)

A pedido do usuário, clicar em "Transcribe Selected Layer" agora abre um
modal de configurações em vez de transcrever na hora -- comprimento da
legenda, limite de caracteres, preset salvo e idioma, tudo configurável
antes de rodar.

- **`client/index.html`/`styles.css`**: `#captions-settings-overlay` --
  um overlay de verdade cobrindo o painel inteiro (`backdrop-filter:
  blur(4px)` + fundo escurecido), diferente dos popovers pequenos e
  ancorados que já existiam (`.settings-popover`/`.fp-popover`). Dentro:
  um controle segmentado (`.segmented`) pra "1 Line"/"2 Lines"/"Word by
  word", um campo numérico de limite de caracteres (desabilitado quando o
  modo é "Word by word"), e dois botões que abrem um seletor -- Caption
  Preset e Language.
- **Seletor reutilizável novo** (`buildOptionPicker`/`openOptionPicker`
  em `client/panel.js`): uma lista com busca opcional, indicador de
  seleção (bolinha, mesmo visual do seletor de Direction já existente) e
  um rodapé opcional de "salvar novo" (campo de nome + botão). Construído
  como componente separado dos pickers já existentes (`choicePicker`,
  `fontPicker`) pra não arriscar mexer no que já funcionava -- reaproveita
  o mesmo CSS (`.fp-popover`/`.fp-list`/`.fp-item`), só variando o que é
  mostrado.
  - **Idioma**: lista com os 99 idiomas oficiais do Whisper (a mesma
    tabela que o próprio whisper.cpp usa, `LANGUAGES` do
    `openai/whisper`), com busca -- passado direto pro `-l` do
    `whisper-cli.exe` (antes fixo em `"auto"`).
  - **Caption Preset**: 3 presets prontos (Default = 2 linhas/42
    caracteres, Single Line = 1 linha/32, Word by Word) mais os presets
    que o usuário salvar (`localStorage`, chave
    `motionfilm-caption-presets`) -- esses aparecem com um "×" pra apagar,
    os prontos não. Escolher um preset aplica o comprimento + limite de
    caracteres dele; digitar um nome no rodapé e clicar "Save" grava as
    configurações atuais como um preset novo.
- **Novo algoritmo de agrupamento** (`buildCaptionsFromTranscript`,
  substituiu o antigo `splitTranscriptIntoPhrases`): em vez de sempre
  cortar por frase, agora cada modo tem sua própria lógica --
  - **Word by word**: uma camada por palavra/token do whisper, ignorando
    o limite de caracteres (não faz sentido "limitar" uma palavra só).
  - **1 Line**/**2 Lines**: empacota os tokens numa legenda até a
    próxima palavra estourar o limite (`charLimit` pra 1 linha,
    `charLimit × 2` pra 2 linhas) OU até bater um fim de frase (nunca
    deixa uma legenda atravessar duas frases, mesmo com espaço sobrando).
    No modo 2 linhas, o texto empacotado passa por `wrapIntoTwoLines()`,
    que insere uma quebra de linha manual (`\r`) no melhor ponto entre
    palavras -- confirmado que o AE respeita `\r` como quebra de linha
    forçada mesmo em texto "de ponto" (sem caixa de texto), sem precisar
    reestruturar como texto de parágrafo.
- **Bug real encontrado (não da extensão em si -- de uma ferramenta de
  teste minha) e revertido**: tentei usar `window.prompt()` do navegador
  pra pedir o nome do preset antes de decidir pelo campo embutido. Ao
  vivo, isso travou a thread de JavaScript do painel inteiro -- nem um
  `1+1` respondia mais depois, e não havia diálogo nenhum que o CDP
  conseguisse detectar ou fechar (`Page.handleJavaScriptDialog` retornou
  "No dialog is showing"). Recuperar exigiu fechar e reabrir o painel de
  dentro do After Effects. **Por isso o campo de nome do preset é um
  `<input>` normal dentro do próprio popover, não um diálogo nativo** --
  e nenhum outro lugar do painel deve usar `window.prompt`/`alert`/
  `confirm` daqui pra frente.
- **Testado ao vivo**: abri o modal com uma camada de áudio selecionada
  (screenshot confirma o visual batendo com a referência do usuário);
  troquei de preset (Single Line aplicou 1 linha + 32 caracteres
  corretamente); busquei "portu" no seletor de idioma (achou só
  "Portuguese", selecionou certo); salvei um preset novo em modo "Word by
  word" (nome apareceu no botão, campo de limite ficou desabilitado); e
  rodei uma transcrição de verdade nesse modo -- 26 camadas de texto
  criadas, uma por palavra, com o texto em inglês correto mesmo com o
  idioma sem querer ainda em "Portuguese" de um teste anterior (o Whisper
  foi robusto o bastante pra não embaralhar o texto, mas fica registrado
  que forçar o idioma errado é um jeito real de piorar a precisão).
- **Limitação conhecida**: no modo "Word by word", um token de pontuação
  isolado (tipo um `."` sozinho, sobra de fim de frase) pode virar sua
  própria "palavra"/camada -- cosmético, não afeta o texto das outras
  legendas, mas pode aparecer uma camada rápida só com pontuação. **Nota:
  corrigido na changelog seguinte** -- essa limitação não existe mais.

## Changelog -- correção real: legenda cortava palavra ao meio e não respeitava o limite de caracteres na linha 2

O usuário reportou, depois de testar, que o limite de caracteres não
estava sendo respeitado e que palavras apareciam cortadas no meio.

- **Causa raiz #1 (corte de palavra no meio)**: `buildCaptionsFromTranscript`
  empacotava direto em cima dos **tokens brutos** do whisper, não de
  palavras inteiras. O whisper.cpp frequentemente quebra uma palavra em
  vários tokens (peças de subpalavra tipo BPE, ou pontuação grudada na
  palavra anterior) -- um token que começa com espaço é o início de uma
  palavra nova; um token sem espaço na frente é continuação da palavra
  anterior. O código antigo ignorava essa distinção e só contava
  caracteres, então se o limite batesse bem entre duas peças da mesma
  palavra, a legenda cortava literalmente no meio dela.
- **Causa raiz #2 (linha 2 sem limite)**: no modo "2 Lines", o código
  empacotava até `charLimit × 2` caracteres corridos e só DEPOIS tentava
  dividir isso em duas linhas (`wrapIntoTwoLines`) -- só a linha 1 era
  checada contra o limite de verdade; a linha 2 recebia "o que sobrasse",
  podendo passar do limite sem checagem nenhuma.
- **Correção**: reescrita em duas partes.
  - `flattenWhisperWords()` (nova) -- funde o stream de tokens em
    palavras inteiras primeiro (token sem espaço na frente = continuação
    da palavra anterior, nunca uma palavra própria), antes de qualquer
    contagem de caracteres.
  - `buildCaptionsFromTranscript()` reescrita pra preencher linha por
    linha, cada uma com seu próprio limite verificado individualmente
    (não só a primeira) -- uma palavra que não cabe na linha atual vai
    pra próxima linha (ou pra próxima legenda, se as linhas da legenda
    atual já estão cheias), nunca cortada. `wrapIntoTwoLines` foi
    removida -- não é mais necessária, já que agora cada linha é montada
    certa desde o início, sem precisar redividir depois.
  - Efeito colateral bom: como pontuação solta (tipo um `.` sozinho) agora
    sempre gruda na palavra anterior em vez de virar seu próprio token,
    a limitação de "token de pontuação isolado virando camada própria"
    no modo Word by word também deixou de acontecer.
- **Testado ao vivo**: transcrevi um áudio de teste com palavras
  propositalmente longas ("Multisyllabic", "Transcription", "extraordinarily"
  etc.) no modo padrão (2 linhas, 42 caracteres). Medi o comprimento de
  cada linha de cada legenda criada -- todas ficaram dentro de 42
  caracteres (37, 20, 41, 41, 42, 40), incluindo a segunda linha de cada
  uma (antes não verificada), e nenhuma palavra apareceu cortada no meio.

## Changelog -- Style Presets: captura e reaplica efeitos/animações de um texto estilizado

A pedido do usuário: selecionar um texto já estilizado à mão (efeitos,
Text Animators, uma animação de entrada) e salvar como preset, pra depois
aplicar esse mesmo visual em cada legenda que a transcrição criar --
mantendo a animação de entrada exatamente no início de cada camada, não
num ponto fixo do tempo.

- **`host/host.jsx` -- `captureLayerStylePreset()`**: caminha
  recursivamente pela árvore de propriedades da camada selecionada e
  captura três raízes: `ADBE Effect Parade` (todo efeito, com todos os
  parâmetros), `ADBE Text Animators` (todo Animator de texto, com
  Seletores e canais), e `ADBE Transform Group` (só as propriedades que o
  usuário de fato animou -- têm keyframe ou expressão -- pra não
  sobrescrever o posicionamento padrão da legenda com um valor estático
  que só por acaso estava ali). "Source Text" nunca é capturado -- cada
  legenda carrega seu próprio texto transcrito.
- **Caminhada genérica, não específica por efeito**: em vez de tratar
  Effect Parade e Text Animators como coisas diferentes, o capturador
  usa o fato de que `PropertyGroup.addProperty()` funciona igual em
  qualquer grupo indexado do AE (Effect Parade, lista de Animators, lista
  de Seletores dentro de um Animator, lista de canais dentro de um
  Animator) -- então uma única função recursiva serve pros dois. A
  distinção real é só: um filho de um grupo **indexado**
  (`PropertyType.INDEXED_GROUP`) precisa de `addProperty(matchName)` pra
  ser recriado; um filho de um grupo **fixo** (`NAMED_GROUP`, como as
  sub-propriedades de um Animator já criado) já existe, só precisa de
  `.property(matchName)`. Confirmado que essa regra bate exatamente com
  como `addTextAnimation()` (já existente, testado antes nesta sessão)
  monta Animator/Seletor/canais na mão.
- **Cada propriedade-folha** guarda expressão (se tiver -- prioridade
  sobre keyframes, já que é o que de fato está controlando o valor),
  senão os keyframes (tempo, valor, tipo de interpolação, e a
  suavização/ease via `KeyframeEase`), senão um valor estático simples.
- **Reaplicação com deslocamento de tempo** (`applyStylePresetToLayer`):
  cada legenda nova recebe `timeOffset = novaCamada.inPoint -
  preset.layerInPoint` (o `inPoint` da camada original no momento da
  captura). Keyframes são recriados em `keyframeTime + timeOffset` --
  então uma animação de entrada de "0.5s desde o início" sempre cai nos
  primeiros 0.5s de CADA legenda, não num instante fixo da composição.
  **Expressões não precisam desse ajuste** -- copiadas do jeito que
  estão, porque `thisLayer`/`inPoint` numa expressão já resolvem sozinhos
  contra a camada em que ela está, seja qual for.
- **Interface**: um botão "Save Style Preset From Selected Layer" na aba
  principal do Captions (fora do modal, já que a captura depende de uma
  camada selecionada na timeline, não de nada relacionado à
  transcrição em si) -- clicar nele chama `captureLayerStylePreset`,
  e se der certo abre um popover pequeno só com campo de nome + botão
  Save (**não** `window.prompt` -- ver lição sobre isso). Dentro do modal
  de configurações, um novo seletor "Style Preset" (reaproveitando o
  mesmo `buildOptionPicker` do Caption Preset/Language) com "None" como
  primeira opção e os presets salvos depois, cada um com um "×" pra
  apagar. A escolha fica salva em `localStorage`
  (`motionfilm-style-presets` pros presets, `stylePresetId` dentro de
  `motionfilm-caption-settings` pra qual está selecionado no momento).
- **Bug pequeno corrigido no caminho**: o `optionPicker` genérico (usado
  pelo seletor de Language e Caption Preset desde a changelog anterior)
  não tinha nenhum jeito de fechar ao clicar fora dele -- só fechava ao
  escolher uma opção ou clicar no "×" do modal. Adicionado ao listener
  global de clique que já fecha os outros popovers do painel
  (`closeFontPicker`, `closeChoicePicker` etc.).
- **Testado ao vivo, ponta a ponta**: criei uma camada de texto de teste
  com fade-in de opacidade animado à mão (0 a 100% em 0.5s, com
  suavização bezier de verdade) e um efeito Drop Shadow, começando em
  `inPoint = 3s`. Salvei como preset "Fade In With Shadow" -- confirmei a
  captura certa lendo de volta o `localStorage` (1 efeito
  "ADBE Drop Shadow", 1 propriedade de Transform com 2 keyframes de
  Opacity, sem expressão). Depois transcrevi um áudio de teste com esse
  preset selecionado -- as 4 legendas criadas (com `inPoint` bem
  diferentes: 0.25s, 2.85s, 4.26s, 5.71s) **todas** vieram com o Drop
  Shadow aplicado e exatamente as mesmas keyframes de Opacity na mesma
  posição relativa (`0` e `0.5` segundos desde o próprio `inPoint` de
  cada uma, valores `0`→`100`) -- confirma que o deslocamento de tempo
  por camada funciona certo.

### Limitações conhecidas

- Não captura Máscaras (`Masks`) nem Time Remap -- só Effect Parade, Text
  Animators e as propriedades animadas do Transform Group.
- Um efeito ou canal de Animator que não existir na versão do AE de quem
  está aplicando o preset (efeito de terceiros não instalado, por
  exemplo) é simplesmente pulado -- sem travar o resto da aplicação, mas
  também sem aviso nenhum de que algo ficou faltando.

## Changelog -- Style Presets: nome de efeito de terceiros vinha como "Unknown Effect"

O usuário testou o Style Preset com um efeito criado pelo script de
terceiros TextEvo2 aplicado na camada de origem -- o efeito recriou
certinho (todos os 49 parâmetros, estrutura Transform/Style igual ao
original), mas apareceu como "Unknown Effect" em vez de "TextEvo" na
camada colada.

- **Diagnóstico ao vivo**: o usuário deixou claro que não quer clonar o
  efeito proprietário do TextEvo2 dentro da nossa extensão -- só que
  funcione quando quem for usar já tiver o TextEvo2 instalado (que é
  gratuito). Isso muda a pergunta de "estamos contornando uma proteção
  de terceiros?" pra "por que um plugin de verdade, já instalado, não
  está sendo referenciado direito?" -- bem diferente, e válido de
  investigar.
- **Causa raiz confirmada por teste direto**: o efeito do TextEvo2 é um
  **Pseudo Effect** (`matchName = "Pseudo/textevo"`), uma categoria real
  de plugin do AE (confirma o que já suspeitávamos desde a pesquisa do
  `reveal-effect-plugin/HANDOFF.md`). Testei chamar
  `effectsProperty.addProperty("Pseudo/textevo")` direto, numa camada de
  teste nova, nesta mesma máquina onde o TextEvo2 está instalado de
  verdade -- a estrutura inteira veio certinha (49 parâmetros com os
  nomes certos), mas `.name` do efeito veio como `"Unknown Effect"`.
  Setando `.name = "TextEvo"` na mão logo depois -- confirmado ao vivo --
  resolveu na hora. Ou seja: um Pseudo Effect não carrega um nome de
  exibição próprio (diferente de efeitos nativos como Drop Shadow); quem
  cria a instância (o painel do TextEvo2, normalmente) tem que setar
  `.name` explicitamente -- e o nosso capturador não estava salvando
  nem reaplicando esse nome pra NENHUM efeito, nativo ou de terceiros
  (só não dava pra notar com efeitos nativos, porque `addProperty` já
  usa o nome certo como padrão pra eles).
- **Correção**: `captureStyleNode()` em `host.jsx` agora também captura
  `.name` pra todo filho de grupo indexado (efeitos, Animators, canais de
  Animator -- qualquer coisa criada via `addProperty`), e
  `applyStyleChildren()` reaplica esse nome logo depois de recriar a
  propriedade. Cobre tanto efeitos de terceiros tipo Pseudo Effects
  quanto qualquer efeito nativo que o próprio usuário tenha renomeado à
  mão (ex.: "Drop Shadow" virar "Sombra do Título").
- **Testado ao vivo, ponta a ponta**: recriei o efeito `Pseudo/textevo`
  puro numa camada de teste, renomeei pra "TextEvo" (simulando o que o
  TextEvo2 faz de verdade), capturei com o código corrigido -- o JSON
  capturado já veio com `name: "TextEvo"` -- e apliquei numa legenda nova
  via `createCaptionLayers`. A camada resultante mostrou o efeito como
  **"TextEvo"**, não mais "Unknown Effect".
- **Nota pro usuário**: o preset "Palavra por Palavra - Direita" que
  você já salvou antes dessa correção não tem o nome capturado (foi
  salvo com o código antigo) -- vai continuar mostrando "Unknown Effect"
  se usado como está. Basta selecionar a camada de origem de novo e
  clicar em "Save Style Preset From Selected Layer" mais uma vez (pode
  usar o mesmo nome, ou um novo) pra recapturar com a correção.
- **Limitação que continua real**: isso só funciona se a pessoa que for
  usar o preset **também tiver o TextEvo2 instalado** -- sem o plugin
  registrado no AE dela, `addProperty("Pseudo/textevo")` falha (o
  `try/catch` já existente em `applyStyleChildren` pula o efeito
  silenciosamente nesse caso, sem travar o resto da aplicação do
  preset). Isso é esperado e aceito pelo usuário -- é a mesma dependência
  que qualquer efeito de terceiros sempre teve.

## Changelog -- gerenciar presets de estilo + capturar fonte/tamanho/posição

Quatro pedidos do usuário depois de usar o Style Preset pela primeira vez.

- **Botão dividido em dois**: "Save Style Preset From Selected Layer" (um
  botão só, texto estourando/quebrando de forma feia num painel estreito)
  virou dois botões de largura igual lado a lado
  (`.button-row`/`.button-row .secondary-button { flex: 1 1 0; }`) --
  "Save Style Preset" e "Manage Presets".
- **Modal "Manage Presets"** (`#style-presets-manage-overlay`, mesmo
  padrão visual do modal de configurações de legenda): lista todos os
  presets salvos, cada um com botões **Edit** e **Delete**. "Edit"
  transforma a linha num campo de texto editável na hora (Enter salva,
  Esc cancela) -- sem diálogo nativo nenhum, mesmo princípio de sempre.
  "Delete" remove o preset; se for o que está selecionado no momento nas
  configurações de legenda, volta pra "None" automaticamente.
- **Fonte/tamanho/cor do texto agora fazem parte do preset**: antes, a
  captura pulava inteiramente a propriedade "Source Text" (pra nunca
  sobrescrever o texto transcrito de cada legenda com o texto da camada
  de origem) -- só que isso também jogava fora formatação como fonte,
  tamanho, cor, justificação etc. Agora `captureTextDocumentStyle()` em
  `host.jsx` lê o `TextDocument` da camada de origem e guarda só os
  campos de formatação (font, fontSize, fillColor, strokeColor,
  justification, tracking, e mais uma dúzia de campos -- lista completa
  conferida contra a documentação oficial do `TextDocument`), nunca
  `.text`. Na hora de aplicar, `applyTextDocumentStyle()` parte do
  `TextDocument` ATUAL da legenda (que já tem o texto certo) e só
  sobrescreve os campos de formatação capturados.
- **Posição na tela agora também faz parte do preset**: antes, só
  Position/Anchor Point *animados* (com keyframe ou expressão) eram
  capturados -- um Position estático não entrava, de propósito, pra não
  atropelar o posicionamento padrão (embaixo, centralizado) que
  `createCaptionLayers` já define. A pedido do usuário, isso mudou:
  Position e Anchor Point agora são **sempre** capturados, mesmo
  estáticos -- útil pra manter o mesmo posicionamento de legenda ao
  aplicar o preset em vídeos diferentes. Scale/Rotation/Opacity
  continuam só quando animados (esses ainda soam mais como "animação" do
  que "layout fixo").
- **Testado ao vivo, tudo junto**: criei uma camada de texto com
  `fontSize=88`, cor vermelha (`fillColor=[1,0.2,0.1]`), justificação à
  esquerda, e `Position=[300,200]` (bem longe do centro-embaixo padrão).
  Salvei como preset via o botão real do painel -- confirmei os 4 valores
  certinhos no JSON capturado, incluindo `Position`/`Anchor Point` agora
  presentes mesmo sem keyframe. Transcrevi um áudio de teste com esse
  preset selecionado -- as 3 legendas criadas vieram **todas** com
  `fontSize=88`, a mesma cor vermelha, e `Position=[300,200,0]` -- nenhuma
  ficou no posicionamento padrão. Também testei o modal Manage Presets
  com um preset descartável: renomear e apagar funcionaram, e o preset
  real do usuário (“Palavra por Palavra - Direita”) ficou intacto o tempo
  todo.

### Limitação nova

- A posição capturada é um valor de pixel absoluto (`[300,200]`, por
  exemplo) -- se o preset for aplicado numa composição com dimensões bem
  diferentes da composição de origem, a legenda pode não cair
  proporcionalmente no mesmo lugar relativo do quadro.

## Changelog -- Style Presets: keyframes coladas mas a animação (TextEvo2) não rodava

Usuário testou o Style Preset de ponta a ponta com o TextEvo2 de verdade:
colou sem erro de expressão, as keyframes apareciam no timeline, mas a
animação do texto simplesmente não acontecia visualmente.

- **Diagnóstico ao vivo**: comparei o preset salvo no `localStorage` com a
  camada realmente colada -- o JSON capturado tinha expressão em 14 canais
  de Animator Property (Anchor Point 3D, Position 3D, Scale 3D, etc., a
  parte que de fato move o texto), mas nenhum dos 103 canais na camada
  colada tinha expressão nenhuma. A captura estava certa; a aplicação
  descartava a expressão silenciosamente.
- **Causa raiz confirmada por bisecção ao vivo**: `Property.canSetExpression`
  virava `false` no exato momento em que uma Animator Property nova era
  criada -- mas só quando isso passava pela função genérica
  `applyStyleChildren`, nunca reproduzindo com o mesmo código escrito à
  mão fora dela. Isolei até: `ADBE Text Animator Properties` (e `ADBE Text
  Selectors`) reportam `propertyType === PropertyType.NAMED_GROUP`
  (confirmado ao vivo, comparando com as constantes reais do AE), então a
  lógica genérica -- que decide entre `addProperty()` (grupo indexado) e
  `.property()` (grupo nomeado normal, tipo Transform, onde todo filho já
  existe) só olhando esse enum -- tomava o caminho `.property()`. Só que
  esses dois grupos são a exceção: mesmo sendo "nomeados", uma propriedade
  nova exige `addProperty()` pra ser de fato habilitada, igual um grupo
  indexado de verdade. `.property()` num canal ainda não habilitado não dá
  erro nenhum e devolve um objeto que parece uma propriedade válida --
  só que sem `canSetExpression`, fazendo a atribuição da expressão falhar
  em silêncio (capturada pelo `try/catch` já existente).
- **Correção**: `applyStyleChildren()` em `host.jsx` agora força
  `addProperty(matchName)` (com fallback pra `.property()` se a
  propriedade já existir) sempre que o grupo-pai for `ADBE Text Animator
  Properties` ou `ADBE Text Selectors`, independente do que a captura
  registrou em `isIndexedChild` pra aquele filho
  (`STYLE_PRESET_FORCE_ADD_MATCHNAMES`).
- **Testado ao vivo, ponta a ponta, pelo caminho real de produção**:
  recarreguei `host.jsx` e chamei `createCaptionLayers()` (a mesma função
  que o painel chama de verdade) com o preset real do usuário. Antes da
  correção, os 103 canais de Animator vinham todos sem expressão; depois,
  os 14 canais que o preset realmente usa (Anchor Point 3D, Position 3D,
  Scale 3D, Skew, Skew Axis, Rotation, Opacity, Stroke Width, Line Anchor,
  Tracking Amount, Character Replace, Character Offset, Line Spacing,
  Blur) vieram todos com `canSetExpression: true` e o texto exato da
  expressão capturada.
- **Nota pro usuário**: o preset "Palavra por Palavra - Direita" salvo
  antes dessa correção guardou a expressão certinha (o bug era só na
  aplicação, não na captura) -- não precisa recapturar, já deve funcionar
  na próxima vez que for usado.

## Changelog -- Import/Export de Style Presets

Pedido do usuário: usar a extensão numa produtora, com um preset padrão
por cliente, compartilhado entre editores -- cada um trabalhando o vídeo
dele individualmente mas seguindo sempre o mesmo padrão de texto.

- **Formato do arquivo**: `.json` de texto puro, com um envelope simples
  e versionado -- `{ motionFilmStylePresetsFile: true, formatVersion: 1,
  exportedAt, presets: [{ name, preset }, ...] }`. O mesmo formato serve
  tanto pra exportar um preset só quanto vários juntos (um "pacote" de
  cliente com "Título"/"Legenda"/"CTA", por exemplo, tudo num arquivo
  só) -- a importação lê os dois casos igual.
- **Export**: botão novo em cada linha do modal "Manage Style Presets"
  (`Export`, ao lado de Edit/Delete) exporta só aquele preset; um botão
  "Export All" no topo do modal exporta a biblioteca inteira num arquivo
  só. Os dois abrem o diálogo nativo do Windows pra escolher onde salvar
  (`window.cep.fs.showSaveDialogEx` + `writeFile`, confirmado disponível
  ao vivo neste build do CEP) -- importante pro caso de uso real: salvar
  direto numa pasta de rede/nuvem compartilhada da produtora, não numa
  pasta fixa de downloads. Nome de arquivo sugerido já sai sanitizado
  (`\/:*?"<>|` viram espaço) pra nunca falhar no Windows por causa do
  nome do preset/cliente.
- **Import**: botão "Import" no topo do modal abre o seletor de arquivo
  nativo do sistema (`<input type="file" multiple accept=".json">` --
  mais simples e confiável que `cep.fs.showOpenDialogEx` pra esse caso,
  e permite selecionar vários arquivos de uma vez). Cada preset
  importado que colidir de nome com um já existente localmente recebe
  sufixo automático (" (2)", " (3)"...) -- nunca sobrescreve nada
  silenciosamente, sem precisar de diálogo de confirmação bloqueante.
- **Testado ao vivo, ponta a ponta, pelo fluxo real do usuário**: montei
  um arquivo de exportação sintético com dois presets -- um com o MESMO
  nome do preset real já salvo (pra testar a resolução de colisão) e
  outro com caracteres especiais no nome (`Cliente: Loja X/Y`, pra testar
  que só o NOME do arquivo é sanitizado, não o nome de exibição do
  preset) -- e "soltei" ele no `<input>` de import de verdade (via
  `DataTransfer`, disparando o mesmo evento `change` que um clique real
  dispararia). Resultado: os dois importaram, o duplicado virou
  "Horizontal 01 (2)" automaticamente, a barra/dois-pontos no nome
  ficaram intactos, e a mensagem "Imported 2 style presets." apareceu
  certinha. Limpo os dois presets de teste depois -- o preset real do
  usuário ficou intacto o tempo todo.

## Changelog -- correção: botões de Idioma/Preset/Style Preset da aba Captions paravam de responder

Usuário reportou que os botões de preferências da transcrição (Caption
Settings) pararam de funcionar: clicar em Language ou Caption Preset não
mostrava as opções.

- **Causa raiz confirmada ao vivo**: existe um listener global de
  `click` no `document` (usado há tempos, pra fechar color picker, font
  picker etc. ao clicar fora deles) que fecha incondicionalmente
  qualquer popover aberto, `optionPicker` incluso. O clique no botão de
  Language/Caption Preset/Style Preset chamava `openOptionPicker()`
  (que mostra o popover), mas o MESMO clique, ao borbulhar do botão até
  o `document`, disparava esse listener global e escondia o popover de
  volta -- tudo dentro do mesmo evento síncrono, sem erro nenhum
  aparecer em lugar nenhum. Reproduzi isso ao vivo simulando o clique e
  inspecionando o DOM logo em seguida: o popover aparecia populado com
  as opções certas (idiomas, presets) mas com `hidden` já de volta a
  `true`.
- **Por que só esses três botões**: o Color Picker já tinha a proteção
  certa (`event.stopPropagation()` logo no início do clique do swatch)
  -- só faltava replicar o mesmo nos três botões da aba Captions
  (`captions-preset-button`, `captions-language-button`,
  `captions-style-preset-button`), que nunca tiveram essa chamada desde
  que foram criados.
- **Correção**: `event.stopPropagation()` adicionado no clique dos três
  botões, em `panel.js`.
- **Testado ao vivo**: os três voltaram a abrir e PERMANECER abertos
  (`hidden: false` depois do clique, populados com as opções certas --
  3 presets de legenda, 101 idiomas, 2 style presets).

## Changelog -- Import SRT

Pedido do usuário: fechar as funções da aba Captions com uma forma de
importar legendas já cronometradas/ajustadas por outra pessoa (cliente,
outro editor) -- sem passar pelo pipeline de transcrição.

- **Botão "Import SRT File"** na aba Captions, ao lado dos botões de
  Style Preset -- abre o seletor de arquivo nativo do sistema (mesmo
  padrão `<input type="file">` + `FileReader` já usado no Import de
  Style Presets), lê e importa o `.srt` direto.
- **Timing e quebras de linha do arquivo são preservados exatamente
  como estão** -- de propósito, NÃO passa pelo agrupador de caracteres
  (`buildCaptionsFromTranscript`) usado na transcrição, já que quem
  cronometrou a legenda já decidiu onde cada linha quebra. Reaproveita
  a mesma convenção que o modo "2 Lines" da transcrição já usa pra
  texto multi-linha (`"\r"` entre linhas), então cai direto em
  `createCaptionLayers` sem precisar de NENHUMA mudança em `host.jsx`.
- **Aplica o Style Preset atual** (o que estiver selecionado em Caption
  Settings no momento), do mesmo jeito que uma transcrição normal
  aplicaria -- então um preset de cliente já configurado também vale
  pra legenda importada.
- **Tempos do arquivo = tempo da composição** (`0:00:00` do `.srt` =
  início do timeline) -- sem precisar de uma camada selecionada, ao
  contrário da transcrição (que ancora no `inPoint` da camada de
  origem). Decisão deliberada pela simplicidade: uma legenda cronometrada
  por outra pessoa normalmente foi feita em cima do vídeo já exportado,
  que costuma corresponder direto ao tempo da composição.
- **Parser tolerante**: aceita tanto vírgula quanto ponto como separador
  decimal nos timestamps (cobre SRT e VTT sem esforço extra), remove
  tags de formatação (`<i>`, `<b>`, `<font>`) e tags de posição estilo
  VTT (`{\an8}`) em vez de mostrar a marcação crua na legenda, ignora
  BOM e pula o número de sequência de cada cue.
- **Testado ao vivo, ponta a ponta**: criei uma composição de teste
  isolada (aprendendo com a bagunça de camadas de teste deixada na
  composição real do usuário numa sessão de debug anterior), montei um
  `.srt` sintético com timestamp de vírgula, cue com duas linhas e tag
  `<i>`, e uma tag `{\an8}` -- "importei" via o mesmo `<input>` real do
  painel (`DataTransfer` disparando o evento `change` de verdade).
  Resultado: 3 camadas criadas, tempos exatos (`1-3.5s`, `4.2-7.8s`,
  `8-10s`), quebra de linha preservada com `\r`, tags removidas do
  texto final, mensagem "Imported 3 caption layers from SRT." Limpei a
  composição de teste depois.

## Changelog -- abas do topo: nome só aparece na aba selecionada, animado

Pedido do usuário: mudar o visual da barra de abas (Home/Text/Kit/Icons/
Captions) pra só mostrar o NOME da aba selecionada -- as outras ficam só
com o ícone -- com uma animação do nome aparecendo ao clicar.

- **Mudança 100% em CSS**, nenhum HTML/JS tocado -- o JS já alternava a
  classe `.is-active` no clique (`panel.js`, perto da linha 2679), então
  bastou fazer o `<span>` do nome (que já existia dentro de cada botão
  de aba) reagir a essa classe.
- **Técnica**: o `<span>` do nome vai de `max-width: 0` (com
  `overflow: hidden`, então nada aparece nem ocupa espaço) pra
  `max-width: 90px` na aba `.is-active`, com `margin-left` fazendo o
  mesmo trajeto (de `0` até `6px`) -- assim uma aba inativa não deixa
  nenhum respiro estranho onde o nome ficaria. `max-width` foi escolhido
  em vez de `width` justamente por ser animável sem precisar medir o
  texto via JS. A opacidade do nome tem um pequeno atraso (`.08s`) só ao
  ENTRAR, pra ele crescer um pouco antes de aparecer -- fica mais suave
  que crescer e aparecer ao mesmo tempo.
- **Testado ao vivo**: cliquei entre Home/Icons e conferi por screenshot
  (com zoom, via CDP) -- só a aba clicada mostra nome + sublinhado
  verde, todas as outras ficam só com o ícone, sem espaço extra sobrando.

## Changelog -- correção: animação das abas estava "travando"

Usuário reportou que, ao clicar numa aba, os ícones pareciam "ir até um
certo ponto e voltar" -- uma sensação de travamento na animação recém
implementada.

- **Causa raiz**: `max-width` (a técnica original) é uma propriedade que
  afeta layout -- o navegador precisa recalcular o layout inteiro a
  cada frame da transição, o que fica visivelmente instável num
  Chromium mais pesado/ocupado como o do CEP (rodando dentro do próprio
  After Effects). Tentei trocar para `grid-template-columns: 0fr` →
  `1fr` (técnica padrão pra esse tipo de problema) e testei ao vivo
  amostrando `getComputedStyle` a cada ~30ms durante a transição -- o
  valor computado já vinha o final DESDE O PRIMEIRO frame amostrado,
  confirmando que esse Chromium específico não interpola `fr` em
  `grid-template-columns` de jeito nenhum (só "pula" pro estado final).
- **Correção**: técnica FLIP (First-Last-Invert-Play), feita em JS
  (`animateTabLayoutChange` em `panel.js`) -- a largura da aba muda
  instantaneamente (sem transição de CSS nenhuma), mas ANTES da
  mudança o código lê a posição de cada aba, e DEPOIS da mudança aplica
  um `transform: translateX()` que cancela visualmente o salto, depois
  anima esse transform de volta a zero. `transform` roda inteiramente
  no compositor (não recalcula layout a cada frame), então fica suave
  independente de quão antigo ou ocupado o motor de renderização
  esteja. Só a opacidade do nome (o "aparecer" do texto) continua
  usando transição de CSS normal, porque opacidade sempre anima suave
  em qualquer engine.
- **Testado ao vivo, com números**: amostrei a posição (`left`) e o
  `transform` computado da aba "Captions" (a que mais se desloca) a
  cada ~16-30ms durante uma troca de aba real. Resultado: decaimento
  contínuo e suave (`194.56px → 194.19 → 193.82 → ... → 192.33px`,
  convergindo com desaceleração no fim, sem salto nem correção
  abrupta) -- confirma que a interpolação está acontecendo
  quadro a quadro de verdade, não só "parecendo" suave no olho.

## Changelog -- número da versão movido pro cabeçalho

Pedido do usuário: mover o "v0.9.3" (que ficava no rodapé, só na aba
Home, disputando espaço com os botões de Null/Adjustment/Solid) pra
perto do nome "Mótion Film" -- mais intuitivo de ver em qual versão
está rodando, e libera espaço no rodapé.

- `#version-tag` saiu do `<footer>` (que só existe na aba Home) e foi
  pro `<header class="topbar">` (global, visível em toda aba), como um
  selinho discreto (`padding`, fundo levemente destacado, texto
  pequeno) logo depois do nome.
- Sem nenhuma mudança em `panel.js` -- o texto sempre foi estático no
  HTML, nenhum JS referenciava o elemento por ID, só reposicionado.
- Como consequência direta, os 3 botões do rodapé (Null/Adjustment
  re-fit/Solid re-fit) ganharam a largura toda do rodapé pra se
  distribuir, em vez de dividir espaço com o texto da versão.
- **Testado ao vivo**: recarreguei o painel e conferi por screenshot
  (com zoom) -- selo da versão aparece bem ao lado do nome no
  cabeçalho, e os 3 botões do rodapé ocupam a largura inteira agora.

## Changelog -- aba Captions reestruturada no padrão de caixas colapsáveis da Home

Pedido do usuário: a aba Captions estava visualmente destoante do resto
da extensão (só dicas de texto soltas + botões, sem as caixas
"01 / NOME" colapsáveis que Home/Text já usam). Reorganizada em 2 caixas:

- **"01 / TRANSCRIPTION"**: hint de seleção + botão "Transcribe Selected
  Layer" + status de progresso, seguido logo abaixo pelo hint e botão
  "Import SRT File" -- os dois juntos na mesma caixa, já que ambos são
  formas de COLOCAR legendas na composição (por transcrição ou por
  arquivo pronto).
- **"02 / STYLE"**: hint de estilo + os botões "Save Style Preset" /
  "Manage Presets" -- separado por tratar de APARÊNCIA da legenda, não
  de como ela é criada.
- **Reaproveitou 100% o mecanismo de seções colapsáveis já existente**
  (`initCollapsibleSections` em `panel.js`, seletor `main >
  .section[data-section-id]`) -- só transformando `#captions-main` de
  `<div>` pra `<main>` de verdade (mesma tag que a Home usa) e
  envolvendo o conteúdo existente em `<section class="section"
  data-section-id="...">` com o mesmo `.section-tab`/`.section-kicker`/
  `.section-chevron`/`.section-body` de sempre. **Nenhuma linha de JS
  nova** -- colapsar/expandar, animação do chevron, e até lembrar o
  estado colapsado entre sessões (via `localStorage`) vieram de graça.
- **Ajuste de CSS necessário**: `.captions-layout` (o wrapper externo)
  parou de ter seu próprio scroll/padding -- isso agora vem da regra
  global `main { ... }` (mesma que a Home usa), evitando duas barras de
  rolagem aninhadas. `#captions-setup` (a tela de download inicial,
  mostrada ANTES do `<main>` existir) ganhou padding próprio pra
  compensar.
- **Testado ao vivo**: conferi por screenshot as duas caixas expandidas,
  o colapsar/expandir de "01 / TRANSCRIPTION" (recolhe e some o
  conteúdo, igual a Home), e a tela de setup inicial forçada visível
  (padding ainda correto, nada quebrado).

## Changelog -- nova aba "Effects": gerenciador de efeitos entre múltiplas camadas

Pedido do usuário, com uma extensão de terceiros como referência visual
de estrutura (mantendo nosso próprio visual/cores). Objetivo: selecionar
várias camadas na timeline e ativar/desativar/remover o mesmo efeito em
todas de uma vez, sem abrir o Effect Controls de cada camada.

- **Nova aba "Effects"** (`01 / EFFECTS`), mesmo padrão de caixa
  colapsável das outras abas. Lista uma linha por efeito DISTINTO
  (agrupado pelo `matchName` real, não pelo nome de exibição -- que
  pode ter sido renomeado à mão numa camada e não na outra) encontrado
  em QUALQUER camada selecionada -- **união, não interseção**: por
  pedido explícito do usuário, um efeito presente em só 1 das várias
  camadas selecionadas ainda aparece na lista.
- **Checkbox de três estados** por linha: tudo ligado (✓ verde), tudo
  desligado (vazio), ou misto (traço) quando o efeito está ligado em
  algumas camadas selecionadas e desligado em outras. Um clique sempre
  leva a um estado definido (liga tudo, ou desliga tudo) em vez de
  tentar alternar cada instância individualmente.
- **Lixeira por linha**: remove aquele efeito de toda camada
  selecionada que o tiver.
- **Contador "TOTAL EFFECTS: N"** + **toggle mestre** no topo da lista
  -- liga/desliga todos os efeitos de todas as camadas selecionadas de
  uma vez. (Perguntei ao usuário antes de incluir a lixeira por linha e
  esses dois controles do topo, já que a descrição original só falava
  em ativar/desativar -- confirmado que queria os três, exceto um
  botão de "excluir tudo" de uma vez, que ficou de fora por ser
  destrutivo demais sem necessidade clara.)
- **Novo em `host.jsx`**: `getSelectedLayersEffects()` (leitura, agrupa
  por matchName e computa o estado tri-state),
  `setEffectEnabledForSelection(matchName, enabled)`,
  `setAllEffectsEnabledForSelection(enabled)`,
  `removeEffectForSelection(matchName)` -- as três últimas re-percorrem
  a seleção ATUAL do zero a cada chamada (não guardam referência de
  propriedade nenhuma entre chamadas), mesmo princípio já usado no
  resto do arquivo. `removeEffectForSelection` coleta os efeitos a
  remover primeiro e só remove depois, pra não bagunçar os índices
  enquanto ainda está percorrendo o Effect Parade.
- **Novo em `panel.js`**: sondagem a cada 700ms junto com o resto do
  painel (`refreshEffectsManager`), mas só faz a chamada de verdade
  quando a aba Effects está de fato visível -- evita round-trips
  desnecessários pro AE enquanto o usuário está em outra aba. Também
  dispara um refresh imediato ao clicar na aba (sem isso, esperaria até
  700ms mostrando conteúdo velho/vazio).
- **Testado ao vivo, ponta a ponta**, numa composição de teste isolada
  (3 camadas de texto: A com Drop Shadow+Glow, B com Drop Shadow
  desligado+Hue/Saturation, C só com Glow) -- confirmei: lista mostrou
  os 3 efeitos distintos com contagens certas (Glow (2), Drop Shadow
  (2) em estado misto, Hue/Saturation (1) mesmo estando numa única
  camada); clicar no checkbox misto do Drop Shadow ligou nas DUAS
  camadas de uma vez (verificado direto no AE, não só na UI); a
  lixeira removeu Hue/Saturation só da camada B; o toggle mestre
  desligou tudo de uma vez, confirmado também direto no AE
  (`enabled: false` nas 4 instâncias restantes).

## Changelog -- Kit: preview de imagem parada + vídeo ao passar o mouse

Pedido do usuário, com uma extensão de terceiros como referência
visual: cada preset do Kit deveria mostrar uma imagem estática como
preview, e tocar um vídeo da animação de verdade ao passar o mouse por
cima. Usuário deixou claro que ele mesmo vai produzir essas imagens/
vídeos depois -- pediu só pra deixar a FUNÇÃO funcionando.

- **Convenção por nome de arquivo**, sem precisar mexer em código pra
  cada preset novo: `client/assets/kit-previews/<id do preset>.jpg`
  (poster, mostrado em repouso) + `.webm` (toca em loop, mudo, ao
  passar o mouse). Documentado em
  `client/assets/kit-previews/README.md`.
- **`.webm`/VP9, não `.mp4`/H.264**: descoberta ao vivo -- o ffmpeg já
  baixado pra aba Captions tem `libx264` desabilitado nesse build (só
  `libopenh264`, sem AVC licenciado), então um `.mp4` gerado com ele
  não tocava no Chromium do painel. `.webm` funciona nativamente e o
  MESMO ffmpeg já instalado consegue gerar (`libvpx-vp9` está
  disponível) -- sem precisar baixar nada a mais.
- **Fallback automático e silencioso**: se o arquivo (imagem ou vídeo)
  não existir, a classe `no-thumb`/`no-video` correspondente entra
  sozinha (via evento `error` do `<img>`/`<video>`) e o preset volta a
  mostrar o pequeno quadrado animado por CSS que já existia -- nunca
  aparece ícone de imagem quebrada, nunca trava o hover sem fazer nada.
  Isso significa que o preset "Fade In" (que ainda não tem mídia real)
  continua funcionando exatamente como antes.
- **Testado ao vivo, ponta a ponta**: gerei uma imagem+vídeo de teste
  com o próprio ffmpeg já instalado (cor roxa sólida, sem ligação
  nenhuma com o preset real), coloquei em
  `assets/kit-previews/text-fade-in.{jpg,webm}`, e confirmei: (1) em
  repouso, a imagem carrega (`naturalWidth: 320`) e cobre o placeholder
  de CSS; (2) simulando `mouseenter` no tile, o vídeo entra em
  reprodução de verdade (`paused: false`, `currentTime` avançando) --
  como o CDP não consegue capturar frame de `<video>` em screenshot
  (limitação conhecida do Chromium), confirmei de forma definitiva lendo
  o pixel central do frame via `<canvas>` + `getImageData`: veio
  `RGB(160,132,238)`, batendo com a cor roxa `0x9f7aea` codificada no
  vídeo de teste; (3) `mouseleave` pausa o vídeo e volta ao estado de
  repouso. Removi os arquivos de teste depois -- a pasta fica vazia,
  pronta pra receber a mídia real.

## Changelog -- correção: botões de parágrafo (Home/Text) ficavam com o estado antigo

Usuário reportou: clicar num alinhamento diferente (ex.: esquerda) na
aba Text aplicava certinho na composição, mas o painel continuava
mostrando "centralizado" como selecionado.

- **Causa raiz**: `refreshText()` só relê as propriedades de texto
  quando a CAMADA SELECIONADA muda (`currentSelectedLayerKey` vs
  `lastLayerKeyForText`) -- de propósito, pra nunca chamar
  `sourceText.value` num tick de fundo (a cada 700ms) enquanto o
  usuário pode estar editando texto dentro do próprio viewport do AE
  (isso reseta o cursor de edição -- comportamento documentado desde
  antes). Só que clicar num botão de alinhamento no PAINEL não muda a
  camada selecionada, só uma propriedade dela -- então essa guarda
  também bloqueava a releitura depois de um clique nosso, deixando os
  botões (parágrafo, caps, baseline, auto-kern, apply fill/stroke --
  qualquer toggle sem atualização otimista própria) presos mostrando o
  estado de quando a camada foi selecionada pela primeira vez.
- **Correção**: `commitTextField()` (o ponto único por onde todos esses
  campos passam) agora força `refreshText(true)` depois de uma escrita
  bem-sucedida. Isso é seguro mesmo com a preocupação original do
  cursor: só dispara logo depois de um clique deliberado no NOSSO
  painel, nunca como surpresa de um tick de fundo enquanto o usuário
  pode estar digitando dentro do AE.
- **Testado ao vivo**: cliquei nos botões reais do painel (não simulei
  a chamada direto) -- "Right align" e depois "Center" -- confirmando
  que cada clique atualiza o botão ativo corretamente, e conferindo
  direto no AE (`doc.justification`) que o valor real bate com o que o
  painel mostra.

## Changelog -- correção: cursor de edição de texto pulava pro início às vezes

Usuário reportou, numa sessão de uso normal depois da correção anterior
dos botões de parágrafo: às vezes, digitando texto direto no viewport
do AE, uma pequena pausa e retomada fazia o cursor pular pro início do
texto -- e a mesma coisa ao selecionar um trecho e digitar por cima
pra substituir.

- **Causa real: efeito colateral da própria correção anterior.** O fix
  dos botões de parágrafo forçava `refreshText(true)` depois de
  QUALQUER `commitTextField` bem-sucedido -- inclusive os de campos
  numéricos (tamanho da fonte, tracking, leading, kerning, escala,
  largura do traço), que já atualizavam a própria tela sozinhos e
  nunca precisaram disso. Só que esses campos numéricos passam por
  esse MESMO caminho em qualquer edição comum (Enter, ou clicar pra
  fora -- inclusive clicando de volta no viewport do AE pra editar o
  texto ali), não só em casos raros -- então forçar uma leitura de
  `sourceText.value` ali aumentou bastante a chance dela cair bem no
  meio de uma pausa/reseleção de digitação no AE, que é exatamente o
  cenário que a guarda `lastLayerKeyForText` (documentada desde antes)
  existe pra evitar.
- **Correção**: `commitTextField()` agora só força a releitura quando
  explicitamente pedido (terceiro parâmetro `true`) -- e só nos 4
  lugares que realmente não têm outro jeito de mostrar o estado novo
  (parágrafo, Caps/Baseline, Auto-Kern, Auto-Leading). Cores, checkboxes
  de Apply Fill/Stroke e todo campo numérico voltaram a NÃO forçar
  releitura nenhuma -- eles já atualizam a própria tela no clique/blur,
  sempre atualizaram assim, nunca tiveram esse bug.
- **Testado ao vivo, com números**: instrumentei
  `window.__adobe_cep__.evalScript` pra contar chamadas de
  `readTextLayer` -- confirmei que um commit de `fontSize` (numérico)
  NÃO dispara mais `readTextLayer` nenhuma, enquanto um clique em
  "Center" (parágrafo) continua disparando uma, imediatamente depois do
  `setTextValue`. Reconfirmei visualmente que o botão de parágrafo
  ainda reflete o estado certo depois do clique -- a correção original
  continua funcionando, só que sem o efeito colateral.

## Changelog -- correção (tentativa 2): cursor de texto pulava mesmo depois da correção anterior

Usuário confirmou que o bug continuava acontecendo mesmo depois da
correção anterior (que escopava `refreshText(true)` só pros 4 botões
de alternância) -- inclusive gravou o cursor pulando pro MEIO do
texto, exatamente onde a digitação nova sobrescrevia o texto antigo.

- **Causa real, dessa vez**: `readLayerTransform()` em `host.jsx` --
  chamada em TODO tick de 700ms, sem gate nenhum (Transform sempre foi
  considerado "seguro pra sondar continuamente") -- devolvia
  `name: layer.name` na resposta. Conferido: `layer.name` NUNCA foi
  usado em lugar nenhum do painel (nem em `layerSignature`, nem em
  `updateTransformValues`) -- dado morto, lido em todo tick à toa. Só
  que, pra uma camada de texto sem nome próprio, `.name` reflete o
  Source Text ao vivo -- e ler isso parece carregar o mesmo efeito
  colateral de interromper o cursor de edição que ler
  `sourceText.value` diretamente carrega. Isso rodava
  INDEPENDENTEMENTE de qualquer correção no caminho do
  `commitTextField`, explicando por que a correção anterior (que só
  mexeu nesse outro caminho) não resolveu de vez.
- **Correção**: removido `name: layer.name` da resposta de
  `readLayerTransform()` -- o dado nunca teve uso nenhum, então tirar
  não perde nada.
- **Testado ao vivo**: confirmei que a resposta de `readLayerTransform`
  continua estruturalmente correta (índice, 3D, Position/Scale/
  Rotation/Opacity) e que o painel continua mostrando os valores
  certos (testei com Position `[500,300]`) depois da mudança -- sem
  regressão nenhuma na aba Home.
- **Limitação honesta**: não tenho como automatizar "digitar direto no
  viewport nativo do AE, pausar, voltar" pelas ferramentas que uso pra
  testar essa extensão (elas alcançam o painel CEP, não a UI nativa do
  AE) -- então não dá pra provar mecanicamente que o sintoma exato
  sumiu, só que a causa mais provável (uma leitura sem gate, rodando
  sempre, de um dado nunca usado) foi eliminada. Pedido ao usuário pra
  confirmar testando de verdade.

## Changelog -- correção (tentativa 3): reduzida a frequência de sondagem do Transform durante edição de texto

Usuário confirmou: o bug é anterior a qualquer mudança desta sessão
(já acontecia há dias) e acontece mesmo digitando rápido sem pausa
nenhuma -- não só numa pausa. Gravação mostrou o cursor pulando pro
MEIO do texto, exatamente onde a digitação nova sobrescrevia a antiga.

- **Mudança adicional**: `readLayerTransform()` -- chamada em TODO tick
  de 700ms, sem gate nenhum (item anterior já tinha removido o
  `layer.name` de dentro dela) -- agora é pulada na maior parte dos
  ticks quando a camada selecionada já é um texto confirmado e estável
  (mesmo índice de camada de antes, `textState.doc` já carregado): só
  1 em cada 4 ticks (`TRANSFORM_TEXT_POLL_DIVISOR`) chama de verdade,
  cortando a frequência de chamadas ao ExtendScript durante uma sessão
  de edição de texto de ~700ms pra ~2,8s. Camadas que não são texto
  continuam sendo sondadas a cada 700ms normalmente (sem esse risco, e
  é o que mantém Position/Scale etc. ao vivo durante reprodução de
  keyframe/expressão).
- **Descoberta importante sobre a própria metodologia de teste desta
  sessão**: enquanto testava se o throttle realmente reduzia as
  chamadas, encontrei DUAS origens diferentes de chamada rodando ao
  mesmo tempo -- uma batendo com o número de linha de uma versão
  ANTIGA do arquivo (chamada por um `setInterval` de uma carga anterior
  do painel, ainda vivo) e outra com o número de linha certo da versão
  atual. Ou seja: `Page.reload`/`Page.navigate` via CDP (a forma que
  uso pra recarregar o painel depois de cada mudança) não mata o
  `setInterval` da carga anterior -- ele fica "zumbi", rodando pra
  sempre em paralelo com qualquer carga nova. Isso não é um bug no
  código da extensão em si, mas explica por que um teste anterior podia
  "confirmar" um comportamento que na verdade vinha de uma mistura de
  código antigo e novo coexistindo ao mesmo tempo. Documentado em
  detalhe no `HANDOFF.md` (item 30).
- **Pedido ao usuário**: pra testar essa correção (e qualquer uma
  daqui pra frente) num estado realmente limpo, feche e reabra o
  painel de dentro do próprio After Effects (`Window > Extensions >
  Mótion Film`, desligar e ligar de novo) antes de testar -- em vez de
  só continuar usando o painel que já estava aberto durante toda essa
  sessão de correções.

## Changelog -- varredura de código morto

Pedido do usuário depois de resolver o bug do cursor de texto:
verificar se não sobrou código de versões antigas, tipo o "zumbi" que
apareceu durante aquela depuração (esse era um artefato de teste, não
código real -- ver `HANDOFF.md` -- mas valia conferir o arquivo de
verdade também).

- **Método**: comparei cada função declarada em `panel.js`/`host.jsx`
  contra toda referência a ela no resto do arquivo (e, pros exports do
  host, contra as chamadas `hostCall("...")` reais do painel);
  comparei cada classe CSS declarada em `styles.css` contra seu uso em
  `index.html`/`panel.js`; e cada `id="..."` do HTML contra seu uso no
  painel. Confirmei manualmente cada candidato antes de remover
  qualquer coisa -- vários "órfãos" aparentes eram falso positivo (ex.:
  `createShapeNull`/`createShapeAdjustment`/`createShapeSolid` são
  chamados por nome via uma variável, não como string literal; `is-
  error`/`is-success` são montados dinamicamente em `setStatus`).
- **Removido de verdade** (confirmado sem nenhuma referência em lugar
  nenhum):
  - `applyVelocityCurve()` em `host.jsx` (~65 linhas) -- versão
    anterior do "Apply Curve" da aba Curves, substituída por
    `applyVelocityProfile()` (essa sim ligada ao botão de verdade) mas
    nunca removida.
  - `getCompStatus()` em `host.jsx` -- nunca chamada de lugar nenhum.
  - `.cp-sv-black`/`.cp-sv-white`/`.eyedropper-button` em `styles.css`
    -- sobras de um design anterior do Color Picker (o atual usa só
    `.cp-sv`/`.cp-sv-dot`, sem overlay preto/branco separado nem botão
    de conta-gotas próprio).
- **Achado mas NÃO removido** (ainda ativo, ou decisão de produto, não
  código morto de verdade):
  - Dois blocos de diagnóstico "temporário" ainda funcionando
    (`diagMessage`/`result.diag` em `panel.js`, perto de
    `loadFontList` e `createLayer`) -- ligados a dois bugs reportados
    antes desta sessão ("lista de fontes vem vazia" e "null passa do
    fim") cujo status de resolução eu não tenho como confirmar sozinho.
    Continuam mostrando números reais no status quando algo dá errado
    -- não atrapalham nada, só ainda não foram confirmados como
    seguros pra tirar.
  - `#text-paragraph-more` em `index.html` -- um botão "…More"
    desabilitado, sem handler nenhum, na seção Paragraph da aba Text.
    Parece um placeholder de uma funcionalidade planejada e nunca
    concluída, não uma sobra -- não mexi, só reporto.
- **Testado**: recarreguei só o `host.jsx` (via hot-reload do
  ExtendScript, sem tocar no painel -- de propósito, pra não recriar o
  problema de timer zumbi da correção anterior logo depois de você
  conseguir um estado limpo) e confirmei que o arquivo continua
  parseando sem erro e que `applyVelocityProfile`/`createShapeNull`
  (as funções de verdade usadas pelos botões) continuam existindo e
  corretas.

## Changelog -- correção: Style Preset ativando "Fill" vermelho do TextEvo indevidamente

Usuário provou com prints da busca "fill" na Timeline: a camada de
texto criada à mão (nunca tocada pela extensão) não tem NENHUM canal
de fill visível dentro do animator "TextEvo" -- mas a legenda gerada
por transcrição, depois de ter o Style Preset colado, mostra "Fill
Opacity/Color/Hue/Saturation/Brightness" com Fill Color vermelho
sólido.

- **Causa raiz**: efeito colateral direto da correção anterior (que
  forçava `addProperty()` em toda propriedade de
  `ADBE Text Animator Properties`/`ADBE Text Selectors` pra consertar
  expressões que não aplicavam). Esse grupo sempre reporta 103
  propriedades mesmo vazio -- não reflete o que foi realmente
  habilitado. A captura varria todas as 103 sem filtro; a correção
  anterior passou a "adicionar" (ativar de verdade, com efeito na
  renderização) TODAS elas ao aplicar -- inclusive canais como Fill
  Color que o TextEvo nunca ativa nesse estilo de revelação, e que
  antes (usando só `.property()`) ficavam inofensivos.
- **Correção**: só força `addProperty()` num filho desses dois grupos
  se ele tiver expressão ou keyframes capturados -- exatamente o
  conjunto que precisava da correção original. Um valor estático puro
  volta a usar `.property()`, sem efeito de renderização, igual ao
  comportamento de antes.
- **Testado ao vivo**: recarreguei o `host.jsx` e reapliquei o mesmo
  preset real do usuário numa legenda de teste -- `ADBE Text Position
  3D` (dirigida por expressão) continua funcionando normalmente,
  `ADBE Text Fill Color` (estático) voltou ao estado inerte
  (`canSetExpression: false`, o mesmo padrão identificado como "nunca
  realmente ativo" desde a investigação original).
- **Importante**: presets salvos e legendas já coladas ANTES dessa
  correção continuam com o bug -- precisam ser recriadas (apagar a
  legenda e gerar de novo com o preset, ou remover manualmente o
  parâmetro Fill Color no Effect Controls) pra se beneficiar do
  conserto.

## Observações

Esta implementação é nova e usa apenas a API pública de scripting do After
Effects. Os pacotes enviados foram usados somente para entender a organização
geral dos painéis e os objetivos do fluxo; nenhum núcleo protegido ou código
ofuscado de terceiros é executado ou incorporado.

O After Effects não está disponível neste ambiente para validar ações dentro
de uma composição real. A validação final precisa ser feita instalando o
painel no AE 2026.

A compensação de Position da grade de âncora considera Scale e Rotação (Z).
Em camadas 3D com X/Y Rotation ou Orientation diferentes de zero, essa parte
da rotação não entra na compensação, então o resultado pode não ficar
perfeito nesses casos específicos. Camadas com Position separada em X/Y/Z
(dimensões separadas) não são ajustadas por enquanto -- o ponto âncora é
movido, mas a compensação de posição é pulada para essas camadas.

## Sobre a ferramenta nativa "Quick Set Anchor" do After Effects

O After Effects (Beta) está desenvolvendo sua própria versão dessa
funcionalidade, chamada "Quick Set Anchor" (atalho Shift+Tab, também
acessível pelo painel Properties e pela timeline). Ela:
- Também usa uma grade de 9 pontos (cantos, meios das bordas e centro).
- A partir de builds recentes (abril/2026), também reescreve os keyframes
  de Position existentes para a animação continuar com a mesma aparência --
  o mesmo princípio usado neste painel.
- Por enquanto funciona só em camadas 2D (a Adobe ainda está avaliando
  suporte a 3D).
- Também passou a respeitar máscaras da camada no cálculo dos 9 pontos (não
  só o bounding box do conteúdo bruto), diferente deste painel, que usa
  `sourceRectAtTime` (bounding box do conteúdo, sem considerar máscaras).
- Ainda está em beta -- não é uma funcionalidade da versão estável do AE.

## Remoção da aba "Text" (Text Reveal) — 31/08/2026

A implementação antiga da aba Text (reveal por caractere via Text Animator +
Expressible Selector nativos do AE, com os botões Add/Copy/Paste/Remove e o
picker de Direction, descrita em detalhe nas seções acima) foi **removida
por completo** a pedido explícito do usuário: ele está reformulando essa
feature do zero em outra conversa, e a remoção evita que as duas versões
entrem em conflito depois.

O que saiu de cada arquivo:
- **`client/index.html`**: `#page-text` (hint + picker de Direction + os 4
  botões de ação) foi apagado por inteiro, e o botão da aba
  (`#page-tab-text`) também -- **a aba sumiu de vez da barra de
  navegação**, não sobrou nem como placeholder/casca vazia. A troca de aba
  em `panel.js` (`initPageTabs`) é genérica -- lê `data-page` de quem quer
  que exista no DOM --, então não precisou de nenhum ajuste extra pra parar
  de listar essa aba.
- **`client/panel.js`**: todo o bloco "Text tab: Add / Copy / Paste / Remove
  the per-character reveal animation" (`textAnimClipboard`,
  `TEXT_REVEAL_DIRECTIONS`, `textRevealDirectionLabel`, `textRevealState`,
  `refreshTextReveal`, `initTextAnimTools`), a variável de estado
  `lastLayerKeyForReveal`, e as 3 chamadas de conexão (`initTextAnimTools()`
  e as duas chamadas de `refreshTextReveal()` em `init()`/no `setInterval`
  de polling).
- **`host/host.jsx`**: o bloco inteiro (~600 linhas) entre os comentários
  "Text tab: per-character reveal animator" e "Kit tab: ready-made
  presets" -- todas as constantes/funções exclusivas (`TEXT_ANIM_NAME`,
  `findTextAnimator`, `findSliderControl`, `buildRevealExpression`,
  `addTextAnimation`, `copyTextAnimation`, `pasteTextAnimation`,
  `removeTextAnimation`, `readTextRevealDirection`,
  `setTextRevealDirection`, etc.), os 6 exports `$.global.*`
  correspondentes (removidos individualmente -- estavam misturados com
  exports de outras features que continuam ativas), e duas referências
  soltas em comentários dentro de `captureStyleNode` (função do sistema de
  Style Presets, não relacionada) que citavam `applyDirectionLabel` como
  exemplo -- reescritas pra não apontar mais pra uma função que não existe
  mais.
- **`client/styles.css`**: `.text-anim-hint`, `.text-anim-row` e
  `.action-button.danger:hover` (todas exclusivas dessa aba).

**Nada compartilhado foi tocado**, verificado antes de remover:
`openChoicePicker`/`closeChoicePicker`/`buildChoicePicker` (usados por
outras features), `.tx-font-row`/`.tx-font-trigger`/`.tx-chevron` (picker
de fonte da aba Home) e `currentSelectedLayerKey`/`lastLayerKeyForText`
(usados pela seção de Texto da aba Home).

Um backup completo e verbatim do código antigo foi salvo em
`text-reveal-tab-backup.md` (raiz do projeto) antes de apagar. Depois, a
pedido do próprio usuário -- que confirmou que está reformulando a feature
do zero e não precisava mais dele --, esse backup também foi apagado. Ou
seja: essa implementação antiga **não existe mais em lugar nenhum**, nem
neste projeto sem controle de versão; só o resumo acima (e o item
correspondente no HANDOFF.md) documenta como ela funcionava.

**Bug real encontrado depois, causado por essa remoção**: `numberOr()`
era um helper genérico (`typeof value === "number" ? value : fallback`),
não algo exclusivo do Text Reveal, mas morava dentro do bloco apagado --
e o sistema de Style Presets (`applyStylePresetToLayer`) e a própria
criação de legendas (`createCaptionLayers`, o botão "Add captions")
dependiam dele. Resultado: "Add captions" ficou quebrado (`ReferenceError:
Function numberOr is undefined`) até ser descoberto e corrigido durante o
teste ao vivo da feature Kit abaixo. Corrigido recriando `numberOr` como
helper genérico de verdade, junto de `stringify`/`parse`/`activeComp` no
topo do arquivo. Ver item 34 do HANDOFF.md.

## Kit tab: presets do tipo "layer group" (insere camadas novas) — 31/08/2026

Além do tipo de preset que já existia (`KIT_PRESET_HANDLERS`, que só
modifica camada(s) já selecionada(s) -- ex: "Fade In"), o Kit ganhou um
segundo tipo: **cria camada(s) novas do zero** e insere na composição
ativa, ancoradas no playhead atual, sem precisar de nada selecionado.
Pedido explícito do usuário, que descreveu duas necessidades futuras: (a)
"eu mesmo vou animar as camadas e pedir pra você implementar as camadas
selecionadas" -- o caso coberto agora; e (b) "às vezes também vou querer
adicionar comps inteiras" -- inserir uma composição inteira como uma
nova camada, ainda **não implementado**, fica pra quando o usuário pedir
o primeiro preset desse outro tipo.

**Como funciona**:
- `captureLayerStylePreset` (Style Presets) foi refatorada sem mudar seu
  comportamento -- a parte reutilizável (efeitos + text animators +
  transform + estilo de texto de UMA camada) virou `captureLayerStyleParts`,
  usada tanto por ela quanto pela nova `captureSingleLayerTemplate`
  (acrescenta nome, texto, `inPoint`/`outPoint` -- o que falta pra CRIAR
  uma camada do zero, não só reaplicar num alvo existente).
- `captureKitLayerGroupFromNames(namesJson)` -- só de uso interno
  (Claude/desenvolvedor), não exposta na UI do painel -- localiza camadas
  por nome na composição ATIVA e devolve o template completo de cada uma,
  com `offset` (tempo relativo à camada mais cedo do grupo, preserva o
  escalonamento entre elas) e `duration`.
- `KIT_LAYER_GROUP_PRESETS` guarda o resultado de uma captura ao vivo,
  colado à mão como uma entrada nova.
- `createLayerFromKitTemplate` cria a camada (`comp.layers.addText`),
  posiciona no tempo (mesma ordem já testada em `createCaptionLayers`:
  `startTime` → `inPoint` → `outPoint` por último, já que setar `inPoint`
  desloca `outPoint` junto) e **reaproveita `applyStylePresetToLayer` sem
  nenhuma mudança** para aplicar efeitos/animators/transform/texto -- o
  mesmo `timeOffset` relativo a `layer.inPoint` que já funciona pra Style
  Presets também re-ancora corretamente uma camada recém-criada,
  incluindo a correção do Fill Color (Style Presets, seção acima), que
  se aplica aqui automaticamente por reaproveitamento direto.
- `applyKitLayerGroupPreset(id)` é o dispatcher exportado, análogo a
  `applyKitPreset` mas sem exigir seleção -- só uma composição ativa.
- No painel, `KIT_PRESETS` ganhou um campo opcional `kind: "layers"`
  (ausente = comportamento antigo, "modify"); o clique na tile decide
  entre `applyKitPreset` e `applyKitLayerGroupPreset` com base nisso.

**Primeiro preset**: `"text-duo-intro"` ("Duo Intro", categoria Text
reveal) -- capturado ao vivo das camadas "Animado" e "Texto" na comp
"WAZ_01" do projeto real do usuário, que usam TextEvo (Pseudo Effect com
parâmetro "Strength" animado por 2 keyframes, mais um Text Animator
dirigido inteiramente por expressão) -- exatamente o padrão que os Style
Presets já sabiam capturar/reaplicar corretamente.

**Testado ao vivo** (comp descartável, criada e removida a cada teste,
nunca no projeto real): playhead movido pra um tempo diferente de zero,
clique de verdade na tile "Duo Intro" pela UI (não só chamada direta a
`evalScript`) -- confirmado que as 2 camadas aparecem ancoradas no
playhead, com o escalonamento original de ~0.167s entre elas preservado,
TextEvo com os 2 keyframes de Strength reancorados certinho, e a
expressão do Text Animator presente e funcional.

**Pra adicionar um novo preset desse tipo no futuro (curado, via mim)**:
o usuário anima as camadas de verdade numa composição (de teste ou de
projeto) e pede pra capturar; a captura roda `captureKitLayerGroupFromNames(
["Nome1", "Nome2", ...])` ao vivo contra a comp ativa (recarregando
`host.jsx` primeiro), o array `layers` resultante vira uma entrada nova em
`KIT_LAYER_GROUP_PRESETS`, e uma tile correspondente entra em
`KIT_PRESETS` (`client/panel.js`) com `kind: "layers"`. **Isso agora tem
um caminho paralelo self-service** -- ver a seção seguinte.

## Kit tab: barra de botões "Preset layers" / "Preset comp" (self-service) — 31/08/2026

Pedido explícito do usuário: uma barra fixa embaixo da aba Kit, igual a
que a aba Home já tem, com 2 botões -- **"Preset layers"** e **"Preset
comp"** -- pra salvar um preset novo direto pela UI, sem precisar pedir
pra alguém colar JSON em `host.jsx` toda vez (o que a seção anterior
descreve). Os dois convivem: presets curados (`KIT_PRESETS`/
`KIT_LAYER_GROUP_PRESETS`, em `host.jsx`) continuam existindo do mesmo
jeito; isso só abre um segundo caminho, paralelo, pro usuário salvar os
próprios.

**Persistência**: `localStorage` (`motionfilm-kit-presets`), exatamente
como os Style Presets já fazem -- inteiramente do lado do painel, não em
`host.jsx` (que só enxerga os presets curados, embutidos no código).

**Fluxo ao clicar num dos botões**:
1. `hostCall` captura a partir da seleção atual (`captureKitLayerGroupFromSelection`,
   botão "Preset layers") ou da composição ativa (`captureKitCompReference`,
   botão "Preset comp"). Erro aqui (nada selecionado / nenhuma comp
   ativa) para o fluxo sem abrir nada.
2. Se a captura der certo, abre o `openChoicePicker` (mesmo widget
   genérico já usado noutros pickers do painel) perguntando **em qual
   grupo o preset deve entrar** -- uma das 4 categorias já existentes
   (Text reveal / Shapes / Composition / Effects) -- essa é literalmente
   a primeira coisa perguntada, como pedido.
3. Depois abre o `openNamePopover` (o mesmo popover pequeno já usado pelo
   "Save Style Preset") perguntando o nome do preset.
4. Salva `{id, kind, category, label, data}` em `localStorage` e
   re-renderiza a grade, já trocando pra categoria escolhida.

**"Preset comp" não captura propriedade nenhuma em profundidade** -- só
guarda o *nome* da composição ativa no momento do save. Aplicar
(`applyKitCompData`) localiza esse nome dentro de `app.project` e faz
`targetComp.layers.add(sourceItem)` (a mesma operação nativa de arrastar
uma comp do painel Project pra dentro de outra), ancorado no playhead via
`startTime`. **Decisão deliberada, não uma limitação temporária**: uma
composição é um ativo de projeto (referencia footage em disco, outras
comps aninhadas) que não dá pra reconstruir a partir de um JSON genérico
do jeito que uma camada de texto dá -- então **um preset de comp só
funciona de volta no mesmo projeto** em que foi salvo. Um preset de
camadas, ao contrário, é 100% portátil (JSON puro, sem depender de nada
externo continuar existindo no projeto).

**Arquitetura de renderização/aplicação**: `getAllKitPresets()`
(`client/panel.js`) funde os presets curados com os salvos em
`localStorage`, normalizados pro mesmo formato de tile. O clique decide
entre 4 caminhos: `applyKitPreset`/`applyKitLayerGroupPreset` (curados,
por id) e `applyKitLayerGroupData`/`applyKitCompData` (salvos pelo
usuário, dados enviados direto já que só o painel tem acesso ao
`localStorage`). Do lado de `host.jsx`, `applyKitLayerGroupPreset` e a
nova `applyKitLayerGroupData` foram refeitas pra compartilhar o mesmo
núcleo (`applyKitLayerGroupList`), e `captureKitLayerGroupFromNames`/a
nova `captureKitLayerGroupFromSelection` compartilham
`buildKitLayerTemplates` -- nenhuma duplicação de lógica entre o caminho
curado e o self-service.

**Testado ao vivo**: comp de origem descartável com 2 camadas de texto
(uma com Drop Shadow, outra sem, escalonadas por 0.5s) e uma comp de
destino separada, ambas removidas ao final do teste -- clique de verdade
nos 2 botões do footer, nos itens reais do choice-picker e do
name-popover (não chamada direta a `evalScript`). Preset de camadas
aplicado numa comp diferente da de origem, com playhead != 0: as 2
camadas vieram na comp certa, no tempo certo, com o Drop Shadow
preservado só na camada que tinha. Preset de comp aplicado: a comp de
origem apareceu como camada na comp de destino, ancorada no playhead
(`layer.source instanceof CompItem` confirmado).

**Ainda não existe**: renomear um preset já salvo -- só criar e apagar,
por enquanto (ver seção seguinte). Mesmo ponto de partida que os Style
Presets tinham antes de ganharem o modal "Manage Presets" (que também
tem Edit); fica pra quando for pedido.

## Kit tab: botão "Delete preset" — 31/08/2026

Terceiro botão no mesmo footer, ao lado de "Preset layers"/"Preset comp".
Só lista presets **salvos pelo usuário** (`loadKitCustomPresets()`) -- os
curados, embutidos em `KIT_PRESETS`/`KIT_LAYER_GROUP_PRESETS` no código,
nunca aparecem na lista, então não tem como apagar um deles sem querer
por essa via. Clique abre o mesmo `openChoicePicker` genérico já usado
pra escolher categoria, listando `"Nome (Categoria)"` de cada preset
salvo; escolher um remove **imediatamente** -- sem diálogo `confirm()`
nativo, mesmo padrão já usado no botão "Delete" do modal "Manage Style
Presets" (e evita de propósito o `window.confirm`/`alert()` que trava o
painel inteiro, já documentado antes). Sem nada salvo, mostra um status
de erro em vez de abrir um picker vazio.

**Bug real encontrado e corrigido durante o teste ao vivo**: o primeiro
clique não abria o picker (sem erro nenhum aparecendo). Causa: diferente
de "Preset layers"/"Preset comp" (que só abrem seu picker de dentro do
callback assíncrono de um `hostCall`, bem depois do clique original já
ter acabado de borbulhar pelo DOM), o botão Delete abre o picker
**síncrono**, direto no handler de clique -- e sem `event.stopPropagation()`,
o mesmo clique continua subindo até um listener em `document` que fecha
todo popover/picker aberto a cada clique (pensado pra fechar ao clicar
*fora*), fechando o picker no mesmo instante em que abriu. Mesmo bug (e
mesmo conserto) que o antigo picker de Direction do Text Reveal já tinha
resolvido da mesma forma. **Corrigido** com `event.stopPropagation()`
logo no início do handler.

**Testado ao vivo usando a própria feature pra apagar um preset de teste
real** que o usuário tinha criado à mão em Effects ("Loucura"): o picker
mostrou exatamente `"Loucura (Effects)"`, o clique removeu do
`localStorage`, a grade da categoria Effects voltou a mostrar "No
presets in this category yet.", e clicar Delete de novo com tudo já
vazio mostrou o status de erro certo sem abrir um picker vazio.

**Redesenhado logo em seguida, a pedido do usuário** -- ver a próxima
seção: faltava um jeito de "entrar no grupo primeiro e ver os presets"
antes de escolher qual apagar, então o picker-por-nome acima foi
substituído por um fluxo de duas etapas (escolher grupo, depois segurar
a tile).

## Kit tab: apagar por "segurar 3 segundos" em vez de escolher da lista — 31/08/2026

Redesenho do botão "Delete preset" a pedido do usuário. Em vez de abrir
uma lista com o nome de cada preset salvo, agora o primeiro passo é o
**mesmo picker de categoria** do fluxo de salvar ("em qual grupo") --
escolher um grupo troca a grade pra ele e entra em **modo de exclusão**
(`kitDeleteMode`, `client/panel.js`). De lá, apagar um preset específico
não é mais um clique: é **segurar o botão esquerdo do mouse por 3
segundos** em cima da tile -- o nome do preset treme
(`kitPresetShake`, `styles.css`) o tempo todo em que está sendo
segurado, e soltar antes dos 3 segundos cancela sem apagar nada.

**Enquanto o modo está ativo**:
- O clique normal de aplicar um preset (o que insere/aplica de fato) é
  completamente ignorado -- só o hold de 3 segundos faz alguma coisa.
- Segurar numa tile de preset **curado** (Fade In, Duo Intro) não faz
  nada, de propósito -- só presets salvos pelo usuário
  (`preset.custom === true`) podem ser apagados dessa forma, já que os
  curados não têm de onde seriam removidos (estão no código, não no
  `localStorage`).

**O modo de exclusão se desarma sozinho em 3 situações** (todas
testadas ao vivo): depois de um apagar bem-sucedido; ao trocar de
categoria pela barra lateral -- mesmo clicando na categoria que já
estava ativa, já que clicar uma categoria sempre significa "só
navegando" a partir daqui; e ao sair da aba Kit pra qualquer outra aba.

**Testado ao vivo, ponta a ponta**: preset novo salvo em "Shapes" →
botão Delete → picker de categoria → "Shapes" → clique na tile
confirmado como ignorado (nada aplicado) → segurar 100ms e soltar
(cancelar): a borda/tremida aparece e some, preset continua salvo →
segurar os 3 segundos completos: preset removido do `localStorage`,
tile some da grade, status "Deleted "X"." aparece. Também confirmado:
segurar numa tile curada em modo de exclusão não faz nada (nem aplica
nem apaga); trocar de categoria pela barra lateral cancela o modo (a
prova: clicar a mesma tile curada depois da troca voltou a aplicar
normalmente -- deu o erro esperado "Select at least one layer first."
por não ter camada selecionada, em vez de simplesmente não fazer nada
como faria em modo de exclusão).

## Kit tab: prévia de vídeo real, gerada automaticamente — 31/08/2026

O mecanismo de prévia (poster + vídeo, toca no hover) já existia desde
uma seção anterior, mas nunca tinha vídeo de verdade nenhum -- dependia
de exportar manualmente e soltar o arquivo na pasta certa, o que nunca
aconteceu, então toda tile sempre caía no placeholder de CSS. Pedido do
usuário: dar uma olhada em como o **BadFX** (extensão de terceiros
instalada no AE dele) resolve isso.

**Investigação, sem copiar nada de terceiros**: o BadFX tem debug
remoto habilitado (`com.badedits.cep/.debug`, porta 8860 pro AEFT) --
inspecionei só estrutura e comportamento via Chrome DevTools Protocol
(nunca código-fonte ou assets deles). Achado: cada tile deles é um
`<img>` (poster) + `<video muted loop preload="metadata">` pausado, que
só toca no `mouseenter` -- **exatamente o mesmo mecanismo que esta
extensão já tinha implementado antes**. A única diferença real é que
eles carregam os arquivos como Blob (provavelmente proteção de conteúdo
pago); pra presets locais isso não faz sentido, arquivo estático já
resolve. Ou seja: **o problema nunca foi o mecanismo de exibição -- era
a ausência do vídeo em si.**

**Pipeline de renderização construído** (dispara automaticamente logo
depois de salvar um preset pelo footer "Preset layers"/"Preset comp"):

- `renderKitPreviewClip` (`host/host.jsx`) cria uma comp temporária
  (kind "layers": no tamanho/fps capturados -- ver abaixo) ou usa a
  comp real diretamente sem duplicar (kind "comp", já que renderizar
  não altera nada), manda pra Render Queue do AE, e limita a duração
  renderizada a no máximo 2.5s via `timeSpanStart`/`timeSpanDuration`
  **mesmo que a animação/comp real seja bem mais longa** -- testado ao
  vivo: uma comp de 10s pedindo 1s produziu um arquivo de exatamente 1s
  (`video.duration` conferido depois de carregado o arquivo real, não
  só a propriedade ecoada de volta pelo script).
- `captureKitLayerGroupFromSelection`/`captureKitLayerGroupFromNames`
  ganharam `compWidth`/`compHeight`/`compFrameRate` -- necessários
  porque Position/Scale capturados são valores absolutos em pixel;
  recriar numa comp temporária de tamanho diferente do original
  colocaria tudo no lugar errado.
- O template de Output Module é escolhido dinamicamente
  (`pickH264OutputTemplate`, procura em `om.templates` por algo como
  "H.264" com "5 Mbps" de preferência) em vez de um nome fixo -- o nome
  exato varia por versão/idioma do After Effects, e essa extensão
  precisa continuar funcionando em outra máquina.

**A descoberta que mudou o plano inteiro**: cheguei a cogitar reusar o
ffmpeg da aba Captions (`.webm`/VP9, já comprovado funcionando) pro
vídeo final -- mas testei primeiro, ao vivo, se um `.mp4` renderizado
pelo template nativo "H.264 - Match Render Settings" do PRÓPRIO After
Effects tocava no Chromium deste painel. **Tocou perfeitamente**
(`loadeddata`/`canplay`/`play()` todos dispararam sem erro). Esse é um
encoder DIFERENTE do `libopenh264` do ffmpeg bundled (documentado antes
como não confiável aqui) -- não contradiz aquele achado, é só uma
ferramenta diferente resolvendo o mesmo problema. **Resultado: o
pipeline inteiro não depende de ffmpeg nenhum** -- nem pro vídeo (AE
renderiza o `.mp4` direto no destino final, sem arquivo temporário) nem
pro poster (`<canvas>` tira um frame real do próprio `.mp4` já
renderizado via `drawImage`+`toDataURL`, salvo com
`fs.writeFileSync` -- a mesma técnica de captura de frame de vídeo já
confirmada antes nesta sessão). A convenção de arquivo mudou de
`.webm` pra `.mp4` (README da pasta `assets/kit-previews/` reescrito).

**Bug de CSS real encontrado e corrigido durante o teste ao vivo**: o
primeiro preset gerado renderizou e salvou os arquivos certinho no disco
(conferido com tamanhos reais, não-triviais), mas a tile ficava com o
preview colapsado em 0×0 -- invisível. Causa: a regra que esconde o
placeholder de CSS assim que a mídia real carrega
(`.kit-preset-preview:not(.no-thumb) .kit-swatch { display: none; }`,
comportamento correto e intencional) também remove o único filho em
fluxo normal da caixa -- e `aspect-ratio: 16/9` sozinho, sem `width`
explícito, não conseguia mais derivar um tamanho a partir do
`align-items: stretch` do pai flex column, colapsando tudo pra 0.
**Corrigido** com `width: 100%` explícito em `.kit-preset-preview`.
Confirmado ao vivo: `getBoundingClientRect()` foi de `{w:0,h:0}` pra
`{w:126,h:70.875}` (proporção 16:9 exata) depois do fix.

**Limitação real descoberta ao vivo, pré-existente** (não introduzida
por essa mudança): `createLayerFromKitTemplate` só sabe recriar camadas
de **texto** (`comp.layers.addText(...)`, sempre). Um "Preset layers"
salvo a partir de uma camada sólida/forma captura as propriedades de
Transform normalmente, mas ao reaplicar -- ou renderizar a prévia --
vira uma camada de texto vazia, invisível. Descoberto testando o
pipeline de propósito com uma camada sólida (prévia saiu toda preta);
confirmado que **não** era bug do pipeline de renderização repetindo o
teste com uma camada de texto de verdade, que funcionou perfeitamente.
Esse limite já existia desde a criação de
`captureSingleLayerTemplate`/`createLayerFromKitTemplate` (pensada
desde o início pro caso de uso real -- texto com TextEvo -- nunca
formas/sólidos); só ficou visível agora porque antes não havia como
"ver" o resultado sem inserir de verdade numa comp. Não corrigido --
documentado como limitação conhecida.

**Testado ao vivo, ponta a ponta, com texto de verdade**: "Preset
layers" numa camada de texto amarela "HELLO" numa comp preta → render
automático → status "Preview rendered." → tile mostrando o "HELLO"
amarelo de verdade, não um placeholder. Todo o material de teste
(comps, entradas de `localStorage`, arquivos `.mp4`/`.jpg` gerados)
removido ao final.

## Kit tab: dois feedbacks do usuário corrigidos — 31/08/2026

**(a) Apagar um preset não apagava a prévia junto.** O hold-to-delete de
3 segundos (seção acima) só removia a entrada do `localStorage`; o
`.mp4`/`.jpg` gerados automaticamente (seção anterior) ficavam órfãos
em `assets/kit-previews/` pra sempre, mesmo depois do preset "sumir" da
grade. Corrigido com `deleteKitPreviewFiles(id)` (`client/panel.js`),
chamada logo antes de remover a entrada do preset -- apaga os dois
arquivos com `fs.unlinkSync` (guardado por `existsSync` e `try/catch`
individuais, já que um dos dois pode legitimamente não existir se o
render tiver falhado ou nem chegado a rodar, e isso não deve impedir o
preset em si de ser apagado). **Testado ao vivo**: salvou um preset,
confirmou os dois arquivos existindo no disco (`File.exists` via AE),
apagou pelo hold de 3 segundos, confirmou os dois virando `false`.

**(b) Scale estático não vinha no "Preset layers".** Uma camada com
Scale ajustado à mão (ex.: 150%, sem keyframe nem expressão) sempre
voltava com Scale 100% (o padrão) depois de salva e reaplicada como
preset -- mesmo sem nenhuma animação de Scale envolvida. Causa:
`STYLE_PRESET_ALWAYS_CAPTURE_TRANSFORM` (Position/Anchor Point só) foi
desenhado especificamente pro caso de uso dos Style Presets (Captions,
seção "Style Presets" acima): lá, forçar Scale/Rotation/Opacity em toda
legenda que recebe um preset poderia brigar com um tamanho que aquela
legenda específica precisava manter -- por isso ficavam condicionais
(só capturados se animados). O Kit "Preset layers" é um caso bem
diferente: não existe nenhuma "camada existente" cujo tamanho precise
ser protegido, já que o preset CRIA uma camada nova do zero -- o
objetivo ali é reproduzir a aparência exata da original, animada ou
não. **Corrigido**: `captureLayerStyleParts` ganhou um segundo
parâmetro opcional (o conjunto de propriedades sempre capturadas,
default `STYLE_PRESET_ALWAYS_CAPTURE_TRANSFORM` -- Style Presets/
Captions continuam se comportando exatamente como antes, nenhuma
mudança lá), e a captura do Kit passa um conjunto maior
(`KIT_ALWAYS_CAPTURE_TRANSFORM`: Position, Anchor Point, Scale, Rotate
Z, Opacity). **Testado ao vivo**: camada de texto com Scale
`[150,150,100]` setado à mão → capturado corretamente no JSON do preset
salvo (conferido lendo o `localStorage` de volta) → aplicado numa comp
de destino nova → camada resultante confirmada com `[150,150,100]` de
verdade, não mais o `[100,100,100]` padrão.

## Kit tab: remoção dos presets curados de teste — 31/08/2026

"Fade In" e "Duo Intro" eram presets de teste da fase de desenvolvimento
do sistema de presets do Kit. Removidos a pedido do usuário agora que
"Preset layers"/"Preset comp" funcionam de ponta a ponta (self-service,
com prévia de vídeo real) -- os presets de verdade passam a ser salvos
direto pela UI, sem depender de nenhum curado hard-coded no código.

Removido: `KIT_PRESET_HANDLERS["text-fade-in"]` e
`KIT_LAYER_GROUP_PRESETS["text-duo-intro"]` (`host/host.jsx`, os dois
objetos ficaram vazios -- a infraestrutura de dispatch por id continua
lá, útil se algum preset curado for adicionado à mão no futuro); as
duas entradas correspondentes em `KIT_PRESETS` (`client/panel.js`); e o
CSS exclusivo de "Duo Intro" (`.kit-swatch.kit-anim-duo-intro` +
`@keyframes kitPreviewDuoIntro`). **Não** removido:
`.kit-anim-fade-in`/`kitPreviewFadeIn` -- continua sendo o placeholder
genérico reusado por qualquer preset "layers" recém-salvo enquanto a
prévia de vídeo real ainda não terminou de renderizar.

**Testado ao vivo**: depois de recarregar painel e `host.jsx`, a grade
da aba Kit passou a mostrar só o preset que o próprio usuário já tinha
salvo pela UI nova ("WAZ_01", com a prévia de vídeo real funcionando) --
confirmando que a remoção não afetou nenhum preset salvo pelo usuário,
só os dois hard-coded no código.

## Kit tab: bug da prévia "sumindo" + overlay do mascote durante o render — 31/08/2026

Três feedbacks reais do usuário, todos corrigidos e testados ao vivo.

**(a) Bug: a prévia ficava cinza ao tirar o mouse de cima da tile.**
Causa: `.kit-preset-thumb` (poster) e `.kit-preset-video` faziam
crossfade de opacidade em direções opostas ao ligar/desligar
`.is-playing` -- numa transição real (não instantânea), existe uma
janela genuína onde nenhum dos dois está totalmente opaco, revelando o
fundo escuro de `.kit-preset-preview` por baixo (mais perceptível num
clipe mais pesado/lento pra decodificar). **Corrigido** trocando o
design: o poster agora fica **sempre opaco** (nunca mais é desligado) e
só o vídeo tem opacidade animada, por cima dele -- trocada a ordem de
inserção no DOM (`thumb` antes de `video`, então o vídeo pinta por
cima) e removida a regra CSS que desligava o poster durante o play.
Isso elimina a classe inteira de bug por construção: não existe mais
nenhum estado onde os dois ficam transparentes ao mesmo tempo, já que o
poster não depende de transição nenhuma. **Testado ao vivo**: 5 ciclos
rápidos de mouseenter/mouseleave (80-200ms de intervalo) -- opacidade
do poster ficou em `1` o tempo inteiro, em todas as rodadas.

**(b)/(c) Overlay de tela cheia com o mascote da produtora enquanto a
prévia renderiza.** Reaproveitado o mesmo `.modal-overlay` (dim+blur
cobrindo o painel inteiro) já usado nas Caption Settings -- um
`<div id="kit-render-overlay" class="modal-overlay">` novo, sem o
`.modal-panel` das outras (só o `<video>` do mascote), mostrado/escondido
em volta de `generateKitPresetPreview` via `showKitRenderOverlay()`/
`hideKitRenderOverlay()`.

O usuário mandou o vídeo do mascote em 2 formatos: `.mp4` (369KB,
mascote verde sobre fundo preto sólido) e `.mov` (9.8MB, canal alpha de
verdade -- ~26x mais pesado). Escolhido **MP4 + `mix-blend-mode: screen`**
no CSS: no modo de composição "screen", preto contribui zero no
resultado -- então o fundo preto simplesmente desaparece, revelando o
que estiver atrás (o backdrop já escurecido/borrado do overlay), sem
canvas, sem WebGL, sem decodificar canal alpha nenhum. Copiado como
`client/assets/mascot-loading.mp4` -- o `.mov` mais pesado não entrou no
projeto.

**Testado ao vivo**: o `.mp4` carrega e toca limpo (3840x2160, ~1.2s,
sem erro); screenshot com zoom confirmou o mascote compositando de
forma limpa sobre o fundo escuro do painel, sem caixa preta nenhuma ao
redor. Fluxo completo testado salvando um preset de verdade: overlay
visível e mascote tocando confirmados no meio do processamento (timing
preciso medido dentro do próprio script, já que a renderização real é
rápida demais -- 1 a 2 segundos -- pra flagrar por screenshots
separados via CDP); depois de terminar, overlay escondido e mascote
pausado confirmados também.

## Kit tab: mascote toca uma vez na confirmação (não em loop) + prévia 60% maior — 31/08/2026

Dois ajustes finos pedidos pelo usuário depois de ver o overlay do
mascote (seção acima) funcionando ao vivo.

**(a) O mascote tocava em loop durante todo o processamento -- deveria
tocar uma vez só, disparado pela confirmação de sucesso.** O
comportamento anterior (loop contínuo enquanto a renderização estava em
andamento) era intencional na primeira versão, mas era a leitura errada
do pedido original: "ao finalizar a ação de adicionar a prévia" queria
dizer no MOMENTO em que a prévia termina de ser adicionada (uma
animação de confirmação), não durante o processo inteiro (um indicador
de carregamento). **Corrigido**: removido o atributo `loop` do
`<video>` do mascote; as funções que mostravam/escondiam o overlay em
volta de todo o `hostCall` de renderização viraram uma única
`playKitMascotConfirmation()`, chamada só no branch de sucesso completo
(junto do status "Preview rendered.") -- nunca durante o render em si,
nunca no branch de erro. O overlay se auto-esconde no evento `ended` do
próprio vídeo (não por timeout/duração hardcoded). **Testado ao vivo
com um preset real**: overlay confirmado escondido enquanto o status
ainda dizia "rendering preview…"; mascote tocando confirmado só depois
da confirmação de sucesso; overlay escondido de novo confirmado via o
evento `ended` de verdade disparando (não um timer).

**(b) Prévia da tile do Kit ~60% maior.** Grid tinha 2 colunas fixas de
128px cada -- 128×1.6 ≈ 205px. Trocado pra colunas de **largura fixa**
de 205px (`grid-template-columns: repeat(auto-fill, 205px)`).
**Primeira tentativa corrigida ao vivo**: usar `minmax(205px, 1fr)`
(com esticamento) resultou em tiles de ~264px, não ~205px -- como só
uma coluna cabe na largura atual do painel, o `1fr` esticava essa única
coluna pra preencher todo o espaço sobrando, dando **+106%** em vez dos
**+60%** pedidos. Trocando pra largura fixa (sem `1fr`),
`getBoundingClientRect()` confirmou exatamente `205px` depois do
ajuste. `auto-fill` foi mantido (em vez de travar em "1 coluna" fixo)
pra continuar responsivo: um painel destacado/mais largo cabe 2+
colunas do mesmo tamanho automaticamente, em vez de esticar pra outro
tamanho.

## Kit tab: tile do preview de volta ao tamanho pequeno + mascote bem maior — 31/08/2026

Dois ajustes finos pedidos pelo usuário logo depois de ver a seção
anterior funcionando ao vivo -- dessa vez com print marcando o tamanho
exato pretendido em cada caso.

**(a) Tile do Kit voltou grande demais.** Os 205px da seção anterior
ficaram grandes na prática assim que havia conteúdo de vídeo real
dentro (diferente de quando só existia o placeholder de CSS). Pedido:
menor, até caber 2 lado a lado no mesmo espaço -- o print mostrava as
duas caixas marcadas somando quase exatamente a largura que uma tile de
205px ocupava sozinha. Medido ao vivo: área útil da grade tem 263px --
pra 2 colunas com 8px de gap, `2x + 8 = 263` → `x ≈ 128px`, ou seja, o
tamanho original de antes do aumento de 60%. **Corrigido** voltando
`grid-template-columns` pra `repeat(auto-fill, 128px)` (mesma estrutura
de largura fixa `auto-fill` de antes, só o número mudou) --
`getBoundingClientRect()` confirmou `128px` exato depois do reload.

**(b) Mascote da confirmação ficou pequeno demais.** Media
`200px`/`max-width: 55%`; pedido de bem maior, perto do tamanho
marcado no print (uma caixa ocupando a maior parte da largura do
painel, que mede 407px). **Corrigido** pra `width: 320px; max-width:
85%` -- 320px é o alvo de verdade, 85% só entra como teto de segurança
num painel mais estreito que o normal. **Testado ao vivo**: como o
mascote só aparece por ~1.2s na confirmação de sucesso (rápido demais
pra flagrar por screenshot via CDP com round-trips separados), a
medição foi feita com um loop de espera dentro do próprio script,
testando o estado "tocando" a cada 150ms até pegar o momento certo, só
então lendo o tamanho real -- confirmado `318.75×179.3px` (a pequena
diferença de `320` é só o formato/proporção natural do vídeo, o teto de
85% nem chegou a entrar em ação).

## Kit tab: `mix-blend-mode` não funciona nesse Chromium -- chroma-key manual por pixel — 31/08/2026

O usuário reportou que o fundo preto ao redor do mascote (seções
anteriores) continuava visível de verdade, não sumia. Investigação em 3
passos, cada um eliminando uma hipótese:

**Passo 1** -- segurei o `<video>` num frame parado (em vez de depender
de flagrar os ~1.2s da confirmação por screenshot) e tirei print: caixa
preta sólida visível ao redor do mascote, apesar de
`getComputedStyle(video).mixBlendMode` confirmar `"screen"` -- a
propriedade estava setada, mas não compositava.

**Passo 2** -- hipótese: `<video>` usa um caminho de composição via
hardware separado que ignora blend modes CSS (mais provável ainda num
arquivo 4K). Reescrito pra desenhar cada frame num `<canvas>` via
`drawImage()` + `requestAnimationFrame`, com `mix-blend-mode` no canvas
em vez do vídeo. **Resultado: mesma caixa preta sólida**, sem nenhuma
mudança.

**Passo 3** -- teste decisivo: uma `<div>` branca simples com
`mix-blend-mode: difference` (branco com difference contra qualquer
fundo nunca deveria continuar branco puro), testada ao mesmo tempo
dentro do overlay (que tem `backdrop-filter`) E como elemento
`position:fixed` solto no `<body>`, sem overlay nem `backdrop-filter`
por perto. **As duas renderizaram branco sólido, sem blend nenhum.**
Conclusão: `mix-blend-mode` simplesmente não composita em nenhum
contexto deste build de Chromium/CEP -- não é específico de vídeo, não
é específico de `backdrop-filter`, é a feature inteira que não
funciona.

**Corrigido de verdade** abandonando CSS blend mode por completo e
implementando chroma-key manual por pixel: cada frame desenhado num
`<canvas>` offscreen, `getImageData()` lido, e pra cada pixel `alpha =
Math.max(r, g, b)` -- preto genuíno vira alpha=0 (transparente de
verdade), uma cor saturada (o verde do mascote) fica com alpha alto,
bordas com anti-aliasing saem com alpha intermediário automaticamente.
Matematicamente é o mesmo resultado que "screen contra um destino
preto" produziria, só calculado à mão com canal alpha real em vez de
depender de uma feature CSS que esse build não aplica.

**Testado ao vivo**: pixel de canto do canvas resultado lido via
`getImageData` -- `[0,0,0,0]`, alpha genuinamente zero, não só "parece
preto"; screenshot com o vídeo pausado no mesmo frame de antes
confirmou visualmente **nenhuma caixa preta** -- o mascote aparece
flutuando sobre o conteúdo desfocado do painel atrás dele, exatamente
como pedido desde o início. Fluxo completo (salvar preset real →
aguardar render → aguardar a confirmação tocar e esconder sozinha)
testado de novo do zero depois da reescrita, funcionando ponta a ponta.

## Kit tab: spinner durante o render + toast de erro mais curto — 31/08/2026

Dois feedbacks reais, ambos corrigidos e testados ao vivo.

**(a) Spinner de carregamento durante o render, igual ao da aba
Captions, fundo já borrado/escuro desde o início, some quando a
animação do mascote começa.** Antes disso, o overlay só aparecia no
MOMENTO da confirmação de sucesso -- durante o render de verdade (que
pode levar alguns segundos) não aparecia nada na tela. Pedido: mostrar
o overlay (dim+blur) desde o início do render, com um spinner igual ao
`.captions-spinner` já existente na aba Captions -- reaproveitado o
mesmo visual (anel fino, arco superior na cor de destaque, mesmo
`@keyframes captionsSpin`), só maior e centralizado, com um rótulo
"Rendering preview…" embaixo (mesmo padrão de acoplar spinner+texto que
`.captions-step` já usa). Quando o render+poster terminam com sucesso,
o spinner esconde e o `<canvas>` do mascote assume -- **o overlay em si
(dim+blur) nunca esconde entre as duas fases**, só troca o conteúdo
interno, pra não piscar/re-borrar no meio da transição. O overlay só
esconde de vez: (1) no fim natural da animação do mascote, ou (2)
imediatamente, se o render ou a captura do poster falharem (não tem
mascote pra mostrar num erro).

**Testado ao vivo com um preset real**: logo após salvar (antes do
render de verdade sequer começar a responder), overlay e spinner já
confirmados visíveis com o canvas do mascote ainda escondido -- ou
seja, o spinner aparece imediatamente, sem esperar o render terminar;
depois, tanto a fase do spinner quanto a fase do mascote foram
capturadas dentro da mesma janela de observação sem o overlay nunca ter
escondido entre as duas; no final, escondido de novo, como esperado.

**(b) Toast de erro ficava tempo demais em tela.** Media 7 segundos (o
dobro do toast de sucesso, 4s) -- o usuário mandou print mostrando um
toast de erro ("Select at least one layer first.") ainda visível,
achando muito tempo. **Corrigido** unificando os dois em 4000ms -- não
criou uma duração menor separada pro erro, só igualou ao que os toasts
de sucesso já usavam, pra sobrar só um valor pra lembrar em vez de
dois. **Testado ao vivo**: disparado um erro real (clicar "Preset
layers" sem nenhuma camada selecionada -- o mesmo cenário do print do
usuário) -- toast visível logo após o clique, confirmado escondido
~4.2s depois (contra os ~7s+ de antes).

## Bug real: keyframes eram descartadas quando a propriedade também tinha expressão — 01/09/2026

Feedback do usuário com print: criou um texto, animou o Position com
keyframes E aplicou uma expressão de terceiros ("BOUNCr overSHOOT+",
que lê `value` pra pegar a base animada por keyframe e soma um
overshoot físico em cima). Ao transformar em preset, o preset copiou a
expressão mas **não** levou as keyframes. Como o usuário resumiu: "Sempre
copiar os keyframes de todos as propriedades é importante tambem, é oq
faz isso ser um preset para ser reutilizado depois e poupar trabalho" --
uma propriedade com keyframes + expressão é um padrão real (a
expressão sozinha, sem a base animada por keyframe, não é a mesma
animação), então "copiar só um dos dois" quebra o propósito de um
preset.

**Causa raiz**: tanto `captureStyleNode` quanto `applyStyleLeaf`
(host.jsx) tinham um `return` logo depois de tratar a expressão de uma
propriedade-folha -- ou seja, se a propriedade tinha expressão, o
código nunca chegava no bloco (mais abaixo, no mesmo `if`) que
capturava/aplicava keyframes ou o `value` estático. Virava "ou
expressão ou keyframes", nunca os dois.

**Corrigido** removendo os dois `return`s -- agora `captureStyleNode`
sempre captura a expressão (se houver) E as keyframes/value da mesma
propriedade, e `applyStyleLeaf` aplica primeiro as keyframes/value e
só depois liga a expressão por cima (ordem que importa: setar a
expressão antes preencheria `value`/`setValueAtTime` por cima de uma
propriedade já reagindo à expressão, o que o AE aceita mas é
desnecessariamente frágil -- aplicar keyframes primeiro e a expressão
por último é o caminho direto).

**Testado ao vivo, ponta a ponta** (via a ponte de debug, comp de teste
descartável `MF_TEST_KFEXPR`, criada e removida pelo próprio script):
texto com Position tendo 2 keyframes (`[100,100]` em t=0, `[400,100]`
em t=1) mais a expressão `value + [0, Math.sin(time*10)*10]`. Captura
(`captureKitLayerGroupFromNames`) confirmou expressão E as 2 keyframes
no JSON capturado; aplicação (`applyKitLayerGroupData`) numa nova
camada confirmou os mesmos 2 keyframes (valores e tempos idênticos) com
`expressionEnabled: true` e o texto da expressão intacto. Round-trip
completo bate 1:1 com a origem.

## Kit tab: adicionar novos tópicos/categorias — 01/09/2026

Feedback com print (círculo vermelho embaixo do último item, "Effects",
na barra lateral de categorias): não existia forma de criar categorias
novas no Kit -- só as 4 fixas (Text reveal/Shapes/Composition/Effects).
Sugestão do usuário: um ícone de "adicionar" embaixo do último item da
lista.

**Implementado**: `KIT_CUSTOM_CATEGORIES_KEY` novo em `localStorage`
(`motionfilm-kit-categories`, um array de strings), com
`getAllKitCategories()` mesclando as categorias fixas (`KIT_CATEGORIES`)
com as do usuário -- usado em todo lugar que precisa da lista completa
(barra lateral, seletor de categoria do "Preset layers"/"Preset comp",
e dos novos modos Delete/Export). Um botão "+" (mesmo popover de nome
já usado em outros lugares do painel) aparece sempre depois do último
item da barra, com guarda contra nome duplicado (comparando contra
`getAllKitCategories()` inteiro, fixas + custom). Precisou de
`event.stopPropagation()` no clique do botão -- mesmo padrão já
estabelecido antes nesta sessão: um listener global no `document` fecha
qualquer popover aberto a cada clique, e sem isso o popover recém-aberto
fechava sozinho no mesmo evento.

**Testado ao vivo**: categoria nova criada via o botão, aparece
imediatamente na barra lateral e nos seletores de Preset layers/Preset
comp/Delete/Export, sobrevive a um reload do painel (persistida em
`localStorage`), e tentar criar uma categoria com nome já existente
(fixa ou custom) mostra o erro em vez de duplicar.

## Kit tab: botão "Export preset" — 01/09/2026

Pedido do usuário: "Precisamos de um botão de exportar preset, para que
possamos compartilhar os presets entre os membros da produtora" --
colocado na mesma barra inferior dos outros botões de interação, entre
"Preset comp" e "Delete preset".

**Implementado** reaproveitando a infra que já existia pra exportar
Style Presets (`saveTextFileWithNativeDialog` + `sanitizeFileNamePart`):
um novo modo `kitExportMode` (espelhando `kitDeleteMode`) armado por um
seletor de categoria e, a partir daí, um único clique (não "segurar",
já que exportar não é destrutivo) numa telinha de preset custom dispara
o diálogo nativo de salvar. O arquivo exportado é um envelope JSON
próprio (`{ motionFilmKitPresetFile: true, formatVersion: 1,
exportedAt, preset: { kind, category, label, data } }`) -- versionado
desde já (`formatVersion`) pra poder evoluir o formato sem quebrar
arquivos já exportados. Presets curados/embutidos (não-`custom`) ficam
inertes no modo de exportação -- não tem arquivo de origem próprio pra
oferecer.

**Limitação conhecida, não pedida ainda**: só existe o lado Export por
enquanto -- não tem um botão "Import" correspondente no Kit, então
compartilhar entre membros da produtora ainda não é um ciclo completo
(quem recebe o `.json` exportado não tem como reimportá-lo pelo painel
ainda). Mencionado ao usuário; não implementado preventivamente, pra
não construir o que não foi pedido.

## Bug real: render da prévia do Kit travava o painel inteiro — 01/09/2026

Descoberto ao vivo durante o teste do fix de keyframes+expressão acima:
salvar um preset do Kit (o que dispara `renderKitPreviewClip`) travou o
engine ExtendScript por completo -- até uma chamada trivial
(`JSON.stringify({pong:true})`) ficou sem resposta, tanto num timeout de
8s quanto de 25s. Seguido o protocolo já estabelecido nesta sessão pra
esse tipo de sintoma (não insistir batendo no engine travado -- parar e
avisar o usuário de forma transparente).

**Causa real, explicada pelo usuário**: ao final de um render pela
Render Queue, o AE mostra uma janela nativa perguntando se o render foi
"anexado" (importado de volta) ao projeto, exigindo clique manual em
OK -- e como o engine ExtendScript é single-thread, essa janela modal
bloqueia QUALQUER chamada `evalScript` seguinte até alguém clicar. Não
era um bug de teste (como o "zombie interval" documentado antes nesta
sessão) -- é um bug real na função `renderKitPreviewClip`, que afeta
todo usuário salvando um preset do Kit dali em diante, não só este
teste.

**Causa técnica**: o Output Module herda o `Post-Render Action` salvo
dentro do template aplicado (`applyTemplate("H.264 - Match Render
Settings")`, ou o que o `pickH264OutputTemplate` escolher em cada
instalação) -- e nessa instalação, o template salvo tinha essa opção
como "Import" em vez de "None".

**Corrigido** forçando explicitamente `om.postRenderAction =
PostRenderAction.NONE` logo depois de `om.applyTemplate(...)`, dentro
de um `try/catch` (instalações mais antigas/atípicas podem não expor
esse enum do mesmo jeito -- não-fatal, na pior hipótese a janela antiga
ainda apareceria). Não dependemos do AE reimportar o arquivo de
qualquer forma -- `outPath` já é conhecido de antemão.

**Testado ao vivo, com muito cuidado** (chamadas isoladas, bem
espaçadas, sem sobrepor `evalScript`s): 1) recarregado o `host.jsx`
editado na sessão do AE já aberta via `$.evalFile()`, sem reiniciar o
AE; 2) disparado `renderKitPreviewClip` direto (kind `"layers"`,
autocontido -- cria e remove sua própria comp temporária, sem tocar em
nada do projeto do usuário) -- render terminou com `{"ok":true}`; 3)
logo em seguida, um `pong` simples respondeu imediatamente, sem
travamento e sem nenhuma janela nativa aparecendo. Comp/item da fila de
render já eram removidos automaticamente pela própria função antes
desse fix -- nada ficou pra trás no projeto.

## Kit tab: footer só com ícones + tooltip customizado com atraso de 1s — 01/09/2026

Feedback com print: os 4 botões do footer do Kit ("Preset layers",
"Preset comp", "Export preset", "Delete preset") ficaram espremidos
lado a lado, texto quebrando/difícil de ler. Pedido: deixar só os
ícones visíveis, e mostrar o texto (a descrição já existente, que já
era bem detalhada) só depois do mouse ficar parado em cima do botão por
1 segundo, "como janelinha de leitura" -- não o tooltip nativo do
navegador (`title`), que aparece na hora e não tem controle nenhum de
estilo.

**Implementado**: removidos os `<span>` de texto dos 4 botões
(`.footer-button-labeled` volta a ser só ícone, igual aos botões da
Home); a descrição de cada um migrou do atributo `title` pra
`data-tooltip` (mesmo texto, sem editar o conteúdo -- só mudou de
mecanismo de exibição). `initFooterTooltips()` novo em `panel.js`: uma
única `<div class="footer-tooltip">` reaproveitada pra qualquer
`[data-tooltip]` da página (não hardcoded pros 4 botões do Kit --
qualquer elemento futuro com esse atributo ganha o comportamento de
graça), `mouseenter` arma um `setTimeout` de 1000ms que só então
preenche o texto, posiciona (centralizado horizontalmente sobre o
gatilho, colado acima -- ou abaixo, se não houver espaço acima, caso do
footer que já fica na borda inferior do painel) e adiciona
`.is-visible` (fade-in via CSS); `mouseleave`/`mousedown` cancelam o
timer e escondem na hora.

**Testado ao vivo** (via a ponte de debug, simulando `mouseenter`/
`mouseleave` sintéticos e aguardando com `await` dentro do próprio
script de teste): span de texto confirmado ausente, `title` nativo
confirmado ausente (só `data-tooltip`); tooltip confirmado **escondido**
300ms depois do `mouseenter` e **visível** 1200ms depois (com o texto
completo, correto); `mouseleave` confirmado escondendo na hora.
Screenshot confere visualmente: footer limpo, só ícones, bolha escura
com o texto aparecendo por cima do botão "Export preset".

## Kit tab: botão "Import preset" + descrições dos botões bem mais curtas — 01/09/2026

Dois pedidos do usuário na sequência do item anterior.

**(a) Botão "Import preset"**, contraponto do "Export preset" já
existente -- sem ele, o `.json` exportado por um colega da produtora não
tinha como voltar a virar um preset de verdade no painel de quem
recebe. Colocado entre "Export preset" e "Delete preset" no footer do
Kit (mesmo padrão de posição do Export, perto do que ele complementa).
Reaproveita o MESMO padrão já usado pelo Import de Style Presets
(`<input type="file" hidden>` disparado por `.click()` do botão real +
`FileReader`) -- nada de diálogo nativo próprio, então nenhum risco de
travar em cima de uma janela do SO que eu não consigo fechar sozinho.
`parseImportedKitPresetEntries` aceita tanto o envelope real do Export
(`{ motionFilmKitPresetFile, preset }`) quanto formatos mais soltos
(`{ presets: [...] }` ou um preset "nu"), mesmo espírito tolerante do
parser de import de Style Presets. Nome duplicado vira "Nome (2)",
"Nome (3)" etc (`uniqueKitPresetLabel`); se o arquivo importado citar
uma categoria que ainda não existe localmente, ela é criada na hora
(mesmo `motionfilm-kit-categories` do item "adicionar tópicos") em vez
de falhar ou cair numa categoria genérica. Cada preset importado dispara
`generateKitPresetPreview` (a mesma função que já roda ao salvar um
preset novo) -- chega com preview de vídeo real, não com o placeholder
genérico, exatamente como se tivesse sido criado localmente.

**Testado ao vivo** (via a ponte de debug): simulado um `<input
type="file">` com um `File` construído em memória (contornando o
diálogo nativo de abrir arquivo, que também não dá pra automatizar
sozinho) contendo um envelope de exportação válido -- preset apareceu
no `localStorage` com os dados corretos, categoria nova criada
("QA Import Category"), status "Imported 1 preset -- rendering
preview…", e o render de verdade disparou e terminou (status final
"Preview rendered.", overlay escondido) **sem travar** -- reconfirma o
fix do Post-Render Action (item acima) funcionando também através do
fluxo real da UI, não só de uma chamada direta isolada. `pong` depois
do render respondeu na hora. Artefatos de teste (preset, categoria,
`.mp4`/`.jpg` gerados) removidos depois -- confirmado nenhum arquivo
órfão sobrando em `assets/kit-previews`.

**(b) Descrições dos 5 botões do footer reduzidas a só o nome da
ação.** O texto que virou tooltip no item anterior (movido de `title`
pra `data-tooltip`) ainda carregava a frase técnica original,
explicando o MECANISMO de cada botão em detalhe -- o usuário achou
longo demais pra esse tipo de ação simples, que já existe em outras
áreas do painel. Trocado por só o nome da ação, curto: "Create Layer
Preset", "Create Comp Preset", "Export Preset", "Import Preset",
"Delete Preset". Testado ao vivo junto com o Import (acima): os 5
`data-tooltip` lidos direto do DOM confirmam o texto novo, curto, em
cada botão.

## Kit tab: apagar um tópico inteiro (Shift+click no seletor do "Delete preset") — 01/09/2026

Pedido do usuário: agora que dá pra criar tópicos (categorias) novos,
precisava de um jeito de apagar um também. Ideia dada pronta pelo
usuário: reaproveitar o mesmo botão "Delete preset" -- ele já abre um
seletor perguntando de qual tópico apagar um preset; **clique normal
num nome de tópico continua armando o modo de apagar preset (igual já
era), mas segurar Shift e clicar no nome do tópico apaga o tópico
inteiro** em vez disso.

**Implementado**: `buildChoicePicker` (o popover genérico usado por
Save/Delete/Export) agora repassa o `MouseEvent` original pro callback
`onPick(value, event)` -- Save e Export ignoram o segundo argumento
normalmente, só o Delete lê `event.shiftKey`. `deleteKitCategory(category)`
novo: recusa de cara um tópico embutido (`KIT_CATEGORIES` -- "Text
reveal", "Shapes", "Composition", "Effects" não têm nada em
`localStorage` pra remover, e nenhum preset pode morar num tópico que
não existe), senão remove o tópico de `motionfilm-kit-categories`, todo
preset custom cuja `category` bata com ele de `motionfilm-kit-presets`
(e os arquivos de prévia `.mp4`/`.jpg` de cada um, via
`deleteKitPreviewFiles`, mesma limpeza que apagar um preset avulso já
faz), e devolve `kitState.category` pro primeiro tópico embutido se o
apagado era o que estava selecionado. Sem hold de 3 segundos nem
`confirm()` nativo pra essa ação -- Shift+click já é, por si só, um
gesto deliberado e diferente de um clique normal, mesma lógica de
"fricção no lugar de diálogo nativo" que o hold de presets já usa.

**Testado ao vivo** (tópico/preset de teste descartáveis, via a ponte
de debug, simulando `MouseEvent` com `shiftKey` de verdade): (1)
Shift+click num tópico embutido ("Text reveal") -- recusado com a
mensagem certa, nada mudou no `localStorage`; (2) clique normal num
tópico custom -- continua armando o modo de apagar preset como sempre
(sem regressão); (3) Shift+click no MESMO tópico custom -- apagado de
verdade, junto com o preset de teste que morava nele, mensagem final
"Deleted... and 1 preset in it.", `kitState.category` voltou pro
primeiro tópico embutido, barra lateral confirmada de volta a só os 4
tópicos fixos.

## Kit tab: agora QUALQUER tópico é apagável, inclusive os 4 originais — 01/09/2026

Pedido de acompanhamento do item anterior: "torne qualquer topico
deletavel, inclusive os que criamos inicialmente". O Shift+click já
funcionava pra tópicos custom (criados pelo "+"); os 4 originais
("Text reveal", "Shapes", "Composition", "Effects") ainda eram
recusados de propósito, por serem uma constante fixa no código
(`KIT_CATEGORIES`) em vez de algo salvo no `localStorage` -- não tinha
"de onde apagar".

**Implementado**: `motionfilm-kit-deleted-builtin-categories`, uma
lista nova no `localStorage` só com os NOMES dos 4 originais que o
usuário apagou -- `KIT_CATEGORIES` em si nunca é modificado (continua
uma constante fixa), `getAllKitCategories()` agora filtra essa lista
fora antes de somar os tópicos custom, então um original "apagado"
simplesmente some de todo seletor/barra lateral sem precisar mexer na
constante. `deleteKitCategory()`: se o tópico é um dos 4 originais, vai
pra essa lista de "escondidos"; se é custom, continua removido da lista
de custom de sempre -- os dois caminhos convergem no mesmo passo
seguinte (apaga os presets custom daquele tópico + arquivos de prévia).
Os dois outros pontos que assumiam "Text reveal" sempre vai existir
(`kitState` inicial e o fallback de categoria no Import) passaram a
usar `getAllKitCategories()[0]` em vez do `KIT_CATEGORIES[0]` fixo, pra
não quebrar se justamente esse for o tópico apagado; o Import também
passou a checar contra `getAllKitCategories()` (não contra
`KIT_CATEGORIES` cru) antes de decidir se recria uma categoria como
custom -- importar um preset citando um tópico que o usuário já tinha
apagado localmente recria esse nome como categoria custom, em vez de
silenciosamente ressuscitar o original ou perder o preset. Sem piso
mínimo de tópicos -- dá pra apagar os 4 originais também, o "+" resolve
recriar algum depois se precisar.

**Testado ao vivo**: apagado "Effects" via Shift+click -- some da barra
lateral na hora, `motionfilm-kit-deleted-builtin-categories` grava
`["Effects"]`, o preset real do usuário ("WAZ_01", num tópico
diferente) confirmado intacto; recarregado o painel do zero -- "Effects"
continua ausente (persistiu de verdade, não só em memória); restaurado
depois limpando essa lista, recarregado de novo -- os 4 tópicos
originais confirmados de volta.

## Duração do toast de status: 4s → 2s — 01/09/2026

Feedback do usuário: mesmo já reduzido de 7s pra 4s antes nesta sessão,
ainda achou 4 segundos devagar pra um balão de confirmação simples.
Reduzido pra 2000ms -- continua sendo UM valor só (`statusHideTimer`)
compartilhado entre sucesso e erro, não um par de números pra lembrar.

**Testado ao vivo**: disparado um status real (duplicar nome de tópico
via o botão "+") e medido com `performance.now()` em três marcas --
ainda visível em 1000ms e 1800ms, já escondido aos 2300ms, batendo com
~2s de verdade.

**Nota lateral sobre esse teste**: no meio dessa verificação, um efeito
colateral inesperado apareceu no `localStorage` -- `motionfilm-kit-
deleted-builtin-categories` acabou com 3 tópicos embutidos marcados
como apagados (só "Effects" tinha sido testado de propósito, "Shapes"
e "Composition" apareceram sozinhos) e uma categoria custom duplicada
"Shapes" foi criada por engano. Provável causa: a mesma limitação já
documentada nesta sessão (ver lição do `Page.reload`/`Page.navigate`
via CDP não matando de verdade o contexto JS anterior) -- várias
recargas via a ponte de debug em sequência, numa sessão de teste longa,
podem deixar mais de um contexto zumbi vivo escrevendo no mesmo
`localStorage` compartilhado (é por origem/arquivo, não por aba).
Corrigido na hora (estado resetado direto via `localStorage`,
recarregado, confirmado limpo: os 4 tópicos originais de volta, preset
real do usuário intacto, nenhuma categoria fantasma). **Nenhum dado do
usuário chegou a ser perdido** -- só o próprio estado de teste
temporário (`deletedBuiltins`/categorias custom) ficou temporariamente
inconsistente. Lição pra sessões futuras de teste ao vivo longas
envolvendo o Kit: preferir fechar/reabrir o painel de dentro do AE
(Window > Extensions > Mótion Film) em vez de mais uma recarga via CDP,
se o estado começar a parecer inconsistente com o que o código deveria
produzir.

## Bug real de performance: ferramentas de keyframe (aba Curves) escaneavam a composição inteira — 01/09/2026

Feedback do usuário: aplicar uma curva de velocidade (aba Home/Curves)
demorava mais quanto mais camadas a composição tinha, mesmo selecionando
só UMA camada -- o que não fazia sentido à primeira vista, mas o
usuário suspeitou certo que havia algo pra otimizar.

**Causa raiz**: `forEachKeyedPropertyAnyLayer` (host.jsx) -- usada por
Apply Velocity, Reverse, Reposition, Copy/Paste Keyframe Curves (toda
ferramenta da aba Curves que trabalha em cima de "quais keyframes estão
selecionados") -- precisa considerar TODA camada da composição, não só
as selecionadas, porque dá pra selecionar keyframes por box-select em
várias trilhas do timeline sem selecionar a linha da camada em si. Até
aqui, correto. O problema era COMO ela fazia essa varredura: um walk
RECURSIVO manual (`visitProperties`) de toda a árvore de propriedades
de cada camada -- todo efeito, todo Text Animator, toda sub-propriedade
-- chamando `.value` e `.numKeys`/`.keySelected()` em cada uma, só pra
descobrir que a esmagadora maioria não tinha nada selecionado. Cada uma
dessas chamadas cruza a ponte ExtendScript↔motor do AE, que tem um
custo fixo por chamada relativamente alto -- é esse custo, multiplicado
pela contagem total de propriedades na composição inteira, que
dominava o tempo, não a quantidade real de keyframes selecionados.

**Corrigido** trocando o walk recursivo por `layer.selectedProperties`
-- a própria lista que o AE mantém de quais propriedades estão
destacadas no Timeline (selecionar keyframes, inclusive por box-select,
marca a propriedade dona deles como selecionada ali, do mesmo jeito que
clicar na linha da propriedade faria). Uma chamada barata por camada em
vez de um walk completo -- pra toda camada SEM nada selecionado (a
maioria, numa composição grande), o custo agora é só essa uma chamada.
`repositionSelectedKeyframes`, `copySelectedKeyframeCurves` e
`pasteSelectedKeyframeCurves` tinham a MESMA cópia manual do walk
recursivo espalhada cada uma na sua própria função -- todas as três
convergidas pra usar o mesmo `forEachKeyedPropertyAnyLayer` já
corrigido, em vez de cada uma ter (e precisar de) seu próprio fix.

**Testado ao vivo com números reais** (via a ponte de debug, comp
descartável com 250 camadas Solid, cada uma com o efeito Drop Shadow
aplicado -- só UMA camada com keyframes selecionadas no Position, igual
ao cenário do usuário):
- Varredura antiga (walk recursivo replicado à parte pra comparação):
  **2224ms**.
- Varredura nova (`layer.selectedProperties`): **3ms**.
- Chamada real de ponta a ponta (`applyVelocityProfile`, incluindo a
  aplicação de verdade nas 3 keyframes): **6ms**, resultado
  `{ok:true, changed:3, skipped:0}` -- confirma que continua achando e
  aplicando certinho, não só mais rápido.

Ou seja, ~740x mais rápido só na varredura, com a aplicação completa
saindo praticamente instantânea. E o ganho cresce ainda mais em
composições com mais camadas/efeitos -- o comportamento antigo era
proporcional ao tamanho total da composição, o novo é proporcional (na
prática) só ao que está de fato selecionado.

## Bug real: prévia em vídeo do Kit travava depois de passar o mouse rápido demais — 01/09/2026

Feedback do usuário: colocar e tirar o mouse rapidamente de cima de uma
telinha de preset fazia a prévia "bugar" -- parava de reproduzir e não
voltava a tocar em hovers seguintes.

**Causa raiz**: `video.play()` é assíncrono (devolve uma Promise que só
resolve quando a reprodução de fato começa), mas `video.pause()` é
síncrono. O `mouseenter`/`mouseleave` do tile chamava `play()` e
`pause()` direto, sem se importar se o `play()` do hover anterior ainda
estava "em voo" -- passando o mouse rápido o bastante, um `pause()`
podia rodar em cima de um `play()` que o Chromium ainda nem tinha
começado a atender, e mexer no `currentTime` (reset pra 0 a cada
`mouseenter`) ao mesmo tempo só piorava, empilhando vários pedidos de
seek+play sobrepostos no mesmo `<video>`. O resultado, confirmado pelo
usuário: o elemento ficava preso num estado que nenhum hover seguinte
conseguia mais desatascar.

**Corrigido** com duas flags por telinha: `wantsPlaying` (o que o mouse
quer AGORA) e `playRequestPending` (se já existe um `play()` em voo).
Um `mouseenter` só dispara um novo `currentTime=0` + `play()` se não
houver um pedido pendente -- um hover rápido demais durante um pedido
em andamento só atualiza `wantsPlaying`, sem empilhar outro. Um
`mouseleave` só chama `pause()` na hora se não houver pedido pendente;
se houver, só marca `wantsPlaying = false` e deixa o próprio `.then()`/
`.catch()` do `play()` em voo reconciliar (chamando `pause()` ali,
quando ele finalmente resolver) -- `pause()` nunca mais roda em cima de
um `play()` ainda não resolvido, que era exatamente a corrida que
deixava o vídeo travado.

**Testado ao vivo** (via a ponte de debug, disparando `mouseenter`/
`mouseleave` sintéticos): rajada de 13 entradas/saídas de propósito
sem esperar nada entre elas (pior caso pra essa corrida) -- vídeo
terminou corretamente pausado (última ação da rajada foi um "sair");
em seguida, um hover de verdade segurado -- vídeo confirmado tocando
(`paused: false`) com `currentTime` avançando de verdade ao longo do
tempo (0.70s → 1.10s numa janela de 400ms), provando que voltou a
reproduzir normalmente depois da rajada, não ficou preso.
## Bug real: `refreshShape` nunca ganhou o throttle de edição de texto — 01/09/2026

Usuário reportou que o bug do cursor pulando pra trás enquanto digita
direto no viewport do AE (documentado e "corrigido" em 3 tentativas
anteriores nesta sessão -- ver changelogs acima) voltou a acontecer.

**Causa raiz**: a "tentativa 3" throttlou `readLayerTransform()` (aba
Home/Transform) pra só rodar 1 em cada 4 ticks de 700ms enquanto uma
camada de texto já carregada/estável está selecionada -- mas essa
correção nunca tocou `refreshShape()` (aba Shape). `refreshShape`
chamava `hostCall("readShapeLayer", ...)` em TODO tick, sem gate
nenhum. `readShapeLayerInner` (host.jsx) desiste cedo pra uma camada
que não é shape (`isShape: false`) -- mas só DEPOIS de já ter rodado
`activeComp()`, `selectedLayers()` e `isShapeLayer()` de verdade no
motor do AE. Ou seja: mesmo com uma camada de TEXTO selecionada (nunca
uma shape), essa chamada continuava tocando o engine do AE a cada
700ms -- a mesma classe de colisão com uma edição de texto em
andamento no viewport que `readLayerTransform` tinha antes de ser
corrigido. A correção anterior só cobriu uma das pollers que rodam a
cada tick, não todas.

**Corrigido** aplicando o mesmo mecanismo já usado em
`refreshTransform`: `shapeState.skipCounter` novo, mesma condição
`likelyEditingText` (`textState.doc` carregado + camada selecionada
igual à última lida), mesmo divisor `TRANSFORM_TEXT_POLL_DIVISOR` (1
em cada 4 ticks). Camadas que não são texto continuam sendo sondadas
a cada tick normalmente, sem risco -- só a leitura de Shape enquanto
uma camada de TEXTO já estável está selecionada é que passa a ser
menos frequente.

**Limitação honesta desta vez**: tentei confirmar ao vivo instrumentando
`window.__adobe_cep__.evalScript` pra contar chamadas de
`readShapeLayer` num texto selecionado, mas o resultado ficou
contaminado por dois problemas da MINHA própria metodologia de teste,
acumulados ao longo de uma sessão muito longa de reloads via CDP: (1)
`setInterval`s zumbis de cargas anteriores do painel ainda rodando em
paralelo (documentado desde antes, ver HANDOFF item 30); (2) um
`<script src="panel.js">` sem cache-busting próprio pode continuar
servindo uma cópia antiga do arquivo mesmo depois de recarregar o
`index.html` com um `?cb=` novo -- confirmado com um `fetch("panel.js")`
manual dentro da própria página, que mostrou o arquivo em disco já
correto enquanto o comportamento observado ainda batia com o antigo.
Corrigi meu próprio fluxo de reload (`Network.setCacheDisabled` via
CDP antes de navegar), mas mesmo assim não consegui isolar uma medição
limpa o suficiente pra apresentar um número confiável desta vez -- a
mecânica da correção é idêntica, campo por campo, à do Transform (já
comprovada funcionando), mas a confirmação final por contagem ao vivo
fica pendente. **Pedido ao usuário**: fechar e reabrir o painel de
dentro do próprio AE (Window > Extensions > Mótion Film, desligar e
ligar de novo) antes de testar -- tanto pra validar esta correção num
estado limpo de verdade quanto porque a sessão de testes de hoje
provavelmente deixou vários timers zumbis acumulados no painel que já
estava aberto.

## Aba Captions: botões lado a lado com ícones + descrições viraram tooltip + botão "Change Style" — 01/09/2026

Três pedidos do usuário na aba Captions, com print da seção 01/Transcription.

**(1) Seção "01/Transcription"**: os botões "Transcribe Selected Layer"
e "Import SRT File" (cada um full-width, empilhados, com um parágrafo
de explicação longo acima de cada um) viraram dois botões lado a lado
(`.button-row`, reaproveitado do padrão já usado na seção Style), cada
um com um ícone (ondas de áudio pro Transcribe, seta pra dentro de uma
bandeja -- o mesmo ícone de "Import preset" do Kit -- pro Import SRT) e
rótulo curto ("Transcribe"/"Import SRT"). Os dois parágrafos de
explicação longos foram removidos da tela -- o texto não sumiu, virou
`data-tooltip` nos próprios botões, reaproveitando literalmente o mesmo
`initFooterTooltips()` construído pro footer do Kit (não é código novo
-- essa função já lê QUALQUER `[data-tooltip]` da página, não só as do
Kit).

**(2) Seção "02/Style"**: os dois botões existentes ("Save Style
Preset" → "Save Preset", "Manage Presets" → "Manage") ganharam ícone
(bookmark e lista, respectivamente) e rótulo encurtado pra caber ao
lado do terceiro botão novo (abaixo). O parágrafo de explicação dessa
seção NÃO foi tocado -- só a seção de Transcription pediu a conversão
pra tooltip.

**(3) Botão novo "Change Style"**, terceiro na mesma fileira: resolve
um problema real de fluxo -- gerar uma legenda com um Style Preset já
aplica o mesmo estilo em TODAS as camadas geradas; pra trocar a
animação/aparência de só ALGUMAS camadas depois (sem reescrever o
texto nem retranscrever o vídeo de novo), não tinha ferramenta. Ao
clicar, abre o mesmo tipo de seletor usado no Export/Delete do Kit,
listando os Style Presets salvos; escolher um dispara
`applyStylePresetToSelectedLayers` (host.jsx, novo) na(s) camada(s) de
texto selecionada(s) -- que primeiro chama `clearLayerStyleAnimation`
(também novo: remove TODO Effect Parade, TODO Text Animator, e limpa
expressão + todas as keyframes de cada propriedade do Transform Group,
sem tocar no Source Text) e só depois reaplica `applyStylePresetToLayer`
(a mesma função já usada quando uma legenda nova é gerada ou quando um
Kit preset cria uma camada -- mesmo recálculo de `timeOffset` contra o
`inPoint` da própria camada, então o novo estilo re-ancora certinho no
tempo de onde a legenda já estava, sem mexer na temporização). Camadas
não-texto na seleção são puladas (não-fatal), contabilizadas à parte no
status final.

**Testado ao vivo, ponta a ponta** (via a ponte de debug, num texto de
teste descartável com um efeito e 2 keyframes de Position simulando um
estilo já aplicado, contra um Style Preset REAL do usuário, "tste 3"):
clique no botão real, seletor abriu, selecionado "tste 3" via clique
real no item -- status final "Changed style on 1 layer to "tste 3".".
Conferido depois, direto na camada: o efeito antigo (Drop Shadow)
sumiu, restou só o efeito do preset novo (`Pseudo/textevo`, 1 --
batendo com o preset); as 2 keyframes antigas de Position foram
removidas (`posNumKeys: 0`, sem expressão); o animador de texto do
preset novo está lá (contagem 1, batendo com o preset). Troca completa
confirmada, nada da aparência antiga sobrou. Tooltip do botão
"Transcribe" também testado (dwell de 1s, texto certo). Artefatos de
teste (comp descartável) removidos depois.

## Changelog -- janela satélite "Paleta de Cores" (v0.9.4)

Início de uma nova mecânica: **janelas satélite** que fazem parte do mesmo
bundle da extensão (instaladas junto ao copiar a pasta pro diretório CEP),
abertas de forma independente do painel principal. A primeira é a **Paleta
de Cores**.

### Como a janela satélite é declarada

`CSXS/manifest.xml` agora tem **dois** `<Extension>`: `com.motionfilm.app`
(painel principal) e `com.motionfilm.palette` (`./client/palette.html`,
mesmo `ScriptPath` `./host/host.jsx`). `ExtensionBundleVersion` foi de
`0.9.3` -> `0.9.4`. `.debug` ganhou o segundo id na porta CDP `8093`
(o principal segue na `8092`).

**`AutoVisible` da satélite é `true`** -- igual ao painel principal, e isso
NÃO era o plano original. Com `AutoVisible=false` (abrir só sob demanda
pelo menu `Window > Extensions`), a view CEF da satélite **nunca ganhava
uma superfície de composição** nesse build do CEP: o DOM montava e o JS
rodava (confirmado pela ponte de debug e num navegador isolado), mas nada
era pintado -- painel em branco/cinza com a barra de abas do host
"vazando" atrás (rastro). Testado à exaustão: limpar `cep_cache`, casar a
geometria com a do principal, `--disable-gpu-compositing`, um `<canvas>`
keep-alive repintando a cada frame -- nada resolveu. O AE só compõe um
painel que ele mesmo criou e exibiu no startup. `AutoVisible=true`
resolveu na hora. Custo: a paleta abre junto com o AE toda vez (o usuário
pode fechar; fica fechada até reiniciar).

`palette.html` foi construída como **clone estrutural do `index.html`**
(mesmo `.app-shell`, `.topbar` com o botão `•••` de Appearance, `#status`,
`<main>`, `.footer`, `#settings-popover`, mesma ordem de scripts) mais um
`<canvas id="paint-keepalive">` desenhado ao vivo (o painel principal só
renderiza porque o editor de curvas é um canvas ativo; mantido aqui por
garantia, embora sozinho não tenha resolvido o bug de composição -- quem
resolveu foi o `AutoVisible`).

### Módulo compartilhado -- `client/shared-core.js`

O color picker (`.cp-popover`: SV + hue + hex + conta-gotas) saiu do IIFE
de `panel.js` pra um `client/shared-core.js` (`window.MF`), carregado por
`<script>` antes de `panel.js`/`palette.js` nas duas janelas.
`MF.initColorPicker({ hostCall, onBeforeOpen, setStatus }) -> { open,
close, createSwatch, isOpenFor }`. `MF.color.*` traz os helpers
(`hexToRgb01`, `rgb01ToHex`, `normalizeHexInput`, ...). No `panel.js`,
`createColorSwatch`/`openColorPicker`/`closeColorPicker` viraram aliases
do retorno; as 3 checagens `colorPicker.owner === ...` viraram
`cpApi.isOpenFor(...)`. `saveTextFileWithNativeDialog` e a mini-ponte
`hostCall` **não** foram movidos -- `palette.js` tem a própria cópia.

### A janela (`palette.html` + `palette.css` + `palette.js`)

- Layout horizontal por paleta (estilo painel "Temas de cores" das
  Libraries da Adobe): cada paleta é um card com cabeçalho (nome editável
  + contador + exportar-esta + apagar) e uma faixa de cubos de 34px, com
  um cubo tracejado "+" no fim. `<main>` é o container rolável (estilizado
  pelo `styles.css`, igual ao principal), então a janela cresce
  verticalmente sem limite.
- **Paletas são grupos**: `{ id, name, colors: [{ id, hex, name? }] }`,
  em `localStorage` `"motionfilm-color-palettes"` (mesma mecânica dos
  Style Presets). `localStorage` da satélite é independente do painel
  principal (extensão CEP separada) -- adequado, ela é dona dos próprios
  dados.
- **CRUD**: nova paleta (nome único `Paleta N`), renomear (popover
  inline, sem `window.prompt`), apagar (imediato, sem `confirm()` nativo),
  add/editar/remover cor (abre o color picker compartilhado, modelo
  "live-edit" do painel principal).
- **Import/Export**: envelope `{ type:"motionfilm-color-palettes",
  formatVersion:1, palettes:[...] }` via `saveTextFileWithNativeDialog`
  (diálogo nativo do CEP, Blob como fallback); importação por
  `<input type=file multiple>` + `FileReader`, mesclando com nome único.
  Botão "exportar esta" por paleta. Pra compartilhar entre máquinas do
  escritório.
- **Appearance**: o botão `•••` abre o mesmo popover de Accent/Panel do
  painel principal (lê/grava `motionfilm-accent`/`motionfilm-panel`).

### `host.jsx` -- `applyPaletteColor(argsJson)` + export `$.global.applyPaletteColor`

Clicar num cubo chama `applyPaletteColor({ rgb:[r,g,b] })` (0..1). Por
camada selecionada, com `app.beginUndoGroup` único no loop:

- **Texto** (`layer instanceof TextLayer`): seta `TextDocument.fillColor`
  (+ `applyFill = true`), reescreve o doc (`setValueAtTime` se houver
  keyframe, senão `setValue`). Nenhum efeito criado.
- **Shape** (`isShapeLayer`): `setShapeFillColours` percorre o Contents
  recursivamente (grupos via `"ADBE Vectors Group"`) e seta a cor de
  **todos** os `"ADBE Vector Graphic - Fill"`; se não houver nenhum,
  adiciona um no Contents raiz. Nenhum efeito criado.
- **Outras que aceitam efeito** (footage, solid, precomp, adjustment,
  null): reusa um `"ADBE Fill"` já presente (busca por `matchName` num
  loop -- nunca `Array.indexOf`) ou adiciona um, e seta a primeira
  propriedade `PropertyValueType.COLOR` dele (achada por tipo, não por um
  matchName `"ADBE Fill-000x"` chutado). Clicar em outra cor **atualiza**
  o mesmo efeito, não empilha.
- Câmera/luz/etc. entram em `skipped`. Retorno `{ ok, applied, skipped }`.

### Testado

- **Client-side (navegador isolado)**: `palette.html` renderiza, canvas
  keep-alive desenhando, popover de Appearance com os swatches
  compartilhados, CRUD completo, persistência sobrevive a reload, hue do
  picker muda o cubo ao vivo. Painel principal sem regressão (inicializa
  sem erro, picker de Appearance abre com o hex certo, `--accent` muda
  live).
- **Contra o AE de verdade** (`applyPaletteColor`, comp descartável
  `MF_TEST_PALETTE` com texto + shape + sólido, removida ao final):
  texto -> fonte vermelha, `applyFill=true`, 0 efeitos; shape -> fill
  vetorial verde, 0 efeitos; sólido -> efeito `ADBE Fill` cor azul;
  sólido + outra cor -> mesmo efeito vira amarelo, contagem continua 1
  (não empilha); 3 camadas juntas -> `applied: 3`. Todos os `applyResult`
  vieram `{ ok:true, skipped:0 }`.

### Bug real encontrado (e como não repetir)

**`--` (dois hífens) dentro de um comentário XML (`<!-- ... -->`) é
proibido e faz o CEP descartar o manifesto INTEIRO** -- os dois painéis
"Mótion Film" somem do menu `Window > Extensions`, não só o novo. Aconteceu
3x nesta implementação porque o estilo de comentário do resto do projeto
usa `--` como travessão. Em `manifest.xml`/`.debug`, nunca `--` em
comentário; e `flags` de linha de comando (`--enable-nodejs` etc.) só
podem aparecer como conteúdo de `<Parameter>`, jamais escritas no texto de
um comentário. Validar sempre com um parser
(`powershell -c "[xml](Get-Content -Raw manifest.xml)"`) antes de dizer
que está pronto.

### Ajustes de UI apos feedback inicial

- **Topo removido.** Sem wordmark "Mótion Film", sem botão de Appearance
  (`•••`). A janela e proposital compacta.
- **Cores sincronizadas com o painel mestre.** As duas sao extensoes CEP
  separadas (localStorage independente), entao o tema viaja pelo global
  compartilhado do ExtendScript: `panel.js` `publishTheme()` ->
  `host.jsx` `setSharedTheme`; `palette.js` puxa com `getSharedTheme` no
  load e a cada 1,5s (+ em `focus`/`visibilitychange`), aplicando
  `--accent`/`--accent-bright`/`--panel` e cacheando em localStorage pro
  primeiro paint apos reiniciar o AE.
- **Rodape removido.** O botao "+" de criar paleta agora fica embaixo da
  ultima paleta (estilo `.kit-category-add` da aba Kit); clicar abre um
  menu (`.fp-popover`) com "Nova paleta" / "Importar paleta".
- **Modo de edicao por grupo.** Cada grupo tem um botao de lapis no
  cabecalho. Fora do modo edicao, os cubos sao so clique-para-aplicar
  (nada de icone no hover, que fazia apagar cor sem querer). No modo
  edicao (`.palette-group.is-editing`): cada cubo mostra lapis + lixeira,
  e o cabecalho ganha os icones de exportar e apagar a paleta. O lapis
  do cabecalho vira check enquanto edita.

### Color picker: passou a usar o seletor NATIVO do After Effects

Historico: o projeto tinha um color picker custom inline (quadrado SV +
barra de hue + hex) porque (a) nao da pra invocar um conta-gotas de tela
por script no AE e (b) a `EyeDropper` do navegador nao funcionava no CEP.
Uma tentativa de reativar a `EyeDropper` (ela existe como
`typeof "function"` no build atual, Chrome 99 / CEP 12) foi testada ao
vivo e **falhou**: `new EyeDropper().open()` rejeita na hora com
`AbortError` ("The user canceled the selection.") -- o Chromium nao
consegue criar o overlay de captura de tela dentro do webview hospedado
pelo AE. Sintoma pro usuario: clicar no conta-gotas nao fazia nada.

Decisao (pedido do usuario): **aposentar o picker custom**. Agora TODA
interacao de cor -- swatch de Fill/Stroke no painel principal, Accent/
Panel em Appearance, e cada cubo da janela de Paleta -- abre o seletor de
cor NATIVO do After Effects (`host.jsx` `pickColorNative`, que ja
existia so pro caminho do conta-gotas). E o unico seletor nesse ambiente
com conta-gotas funcionando, e o que o usuario de AE ja conhece. Um
caminho so, consistente nos dois paineis.

Implementacao: `shared-core.js` `MF.initColorPicker` foi reduzido de
~280 linhas (todo o `.cp-popover`: SV/hue/hex/drag/eyedropper) pra ~60 --
so `openNativePicker()` + `createColorSwatch()`. A API de retorno
(`open` / `close` / `createSwatch` / `isOpenFor`) foi mantida com as
mesmas assinaturas (`close` e `isOpenFor` viraram no-ops) pra `panel.js`
nao precisar mudar os call sites. `MF.color.*` (helpers de conversao)
continua igual. O CSS `.cp-*` em `styles.css` ficou orfao mas foi
deixado (sem risco). Na janela de Paleta, `addColor` deixou de
pre-adicionar um cubo azul: agora so adiciona se o usuario realmente
escolher uma cor (o picker nativo devolve UMA vez, nao um stream).

Limitacao herdada do `pickColorNative`: precisa de uma composicao aberta
(ele cria um Null temporario nela); e "escolher exatamente a cor
inicial" e tratado como cancelar (o dialogo do AE nao informa OK vs
Cancel, entao a mudanca de valor e o sinal).

### Grupos com varias paletas

O card deixou de ser "uma paleta" e virou um **grupo** que contem uma ou
mais **paletas** (linhas de cubos) -- empresas costumam ter mais de uma
paleta (primaria, secundaria) sob a mesma identidade. Modelo:

    [ { id, name, palettes: [ { id, name?, colors: [...] } ] } ]

- **Retrocompativel**: uma entrada antiga `{ id, name, colors:[...] }` e
  lida como grupo de uma paleta so (`normalizeGroup`). Migracao automatica
  no load, sem perder nada.
- No **modo de edicao** do grupo aparece um botao "Adicionar paleta"
  dentro do card; cada linha extra ganha um lixo no fim da faixa (so
  quando ha mais de uma). Nao da pra apagar a ultima linha.
- Renomear/exportar/apagar agora sao do GRUPO (o export leva todas as
  paletas dele). Envelope de export foi pra `formatVersion: 2` com chave
  `groups`; o import aceita `groups` (v2), `palettes` (v1), array cru e
  objeto unico -- tudo passa por `normalizeGroup`.
- Menu do "+" do rodape: "Novo grupo" / "Importar". A chave de
  `localStorage` continua `motionfilm-color-palettes`.

### Reordenar grupos arrastando

Cada cabecalho de grupo tem uma alca (6 pontinhos) a esquerda, fraca ate
o card ser "hoverado". Segurar e arrastar move o grupo pra cima/baixo na
lista; ao soltar, a ordem nova e salva. Implementacao em `palette.js`
(`startGroupDrag` / `onDragMove` / `onDragEnd`): eventos de PONTEIRO (nao
o drag-and-drop HTML5, que e instavel nesse CEF), com os listeners de
move/up no `document` -- mover o proprio no do handle no meio do gesto
derruba o pointer capture nesse Chromium, entao um handle "capturado"
nunca ve o pointerup. Enquanto arrasta, o card passa fisicamente entre
os slots (`insertBefore` quando o ponteiro cruza o meio de um vizinho);
no fim o array `groups` e reconstruido pela ordem do DOM e salvo (os nos
nunca sao recriados, entao nao precisa de re-render).

**Animacao suave**: o card arrastado segue o ponteiro com `transform`
(sem transicao, instantaneo) e ao soltar "assenta" no slot com uma
transicao de `transform`; os vizinhos deslizam pela tecnica FLIP
(`flipSiblings`: le os tops, faz o `insertBefore`, inverte cada um pro
lugar antigo com `transition:none`, forca reflow com
`void els.list.offsetHeight`, depois anima o transform de volta a zero) --
so `transform`, a unica propriedade confiavelmente suave nesse Chromium
(mesma tecnica de `animateTabLayoutChange` no `panel.js`). `.palette-list`
ganhou `position: relative` pra `cardAfterPointer` medir `offsetTop`
(imune a transform) em vez de `getBoundingClientRect` enquanto os
vizinhos animam. Duracao: `DRAG_ANIM_MS = 180`.

## Changelog -- Kit "Preset layers": salva QUALQUER camada (não só texto)

**Bug:** o preset de camadas do Kit só funcionava pra texto. Salvar a
partir de um shape (ou solid/null/ajuste/câmera/luz) gerava uma camada
de TEXTO com a animação daquela camada. Causa: `createLayerFromKitTemplate`
(host.jsx) sempre fazia `comp.layers.addText(...)`, e a captura
(`captureSingleLayerTemplate`) só pegava texto/efeitos/animators/transform
(via `captureLayerStyleParts`, feito pros Style Presets de legenda).

**Correção (host.jsx):**

- `kitLayerType(layer)` detecta `text | shape | solid | null | adjustment
  | camera | light | av`.
- `captureSingleLayerTemplate` reescrita: além de efeitos/transform, agora
  captura -- via a mesma `captureStyleNode` recursiva genérica -- o
  **Contents inteiro de shape** (`ADBE Root Vectors Group`), **máscaras**
  (path + mode + inverted + rotoBezier + color), **transform completo**
  (todas as props, não só as animadas), **material options** e
  **geometry options** de camadas 3D, **time remap**, cor/tamanho de
  solid, tipo de câmera/luz, e **flags** da camada (3D, blend mode,
  motion blur, guide, quality, auto-orient, sampling quality, shy,
  collapse, enabled). `captureLayerStyleParts` / `applyStylePresetToLayer`
  **não foram tocados** (Style Presets continuam text-only) -- confirmado
  ao vivo sem regressão.
- `createLayerFromKitTemplate` reescrita com `switch(layerType)`: cria o
  tipo certo (`addShape`/`addSolid`+`adjustmentLayer`/`addNull`/`addCamera`/
  `addLight`/`addText`) e reconstrói cada árvore de propriedade com
  `applyStyleChildren`, re-ancorando keyframes ao `inPoint` da camada nova
  (`timeOffset`).
- `kitShapeSafe` / `reviveShapeValue` (novos, no topo do arquivo):
  achatam um `Shape` (path de shape/máscara) pra objeto plano na captura e
  reconstroem `new Shape()` na aplicação -- `Shape` não sobrevive
  JSON.stringify. Chamados de dentro de `captureStyleNode`/`applyStyleLeaf`
  (aditivo; no-op pra qualquer outro tipo de valor, então seguro pro
  caminho text-only dos Style Presets).
- `buildKitLayerTemplates`: pula camadas `av` (footage/precomp) e calcula
  `parentTemplateIndex` (reparent entre as camadas do grupo).
- `applyKitLayerGroupList`: cria em ordem REVERSA (preserva o
  empilhamento), e 2ª passada resolve reparent + track matte depois que
  todas as camadas existem. Retorno ganhou `skipped`.
- `captureKitLayerGroupFromSelection`: devolve `avSkipped`; o painel avisa
  no status quando footage/precomp foram ignorados.

**Testado ao vivo** (comp descartável, uma camada de cada tipo, com
keyframes/expressão, 3D, máscara, blend mode != Normal, shape parenteado
num null): aplicar o preset numa comp nova com playhead != 0 -->
`{ok:true, applied:7, skipped:0}`; cada camada recriada como o TIPO certo;
shape com Contents/fill/rotação-keyframes/máscara; solid/ajuste com
cor+tamanho e `adjustmentLayer`; câmera/luz com o tipo (SPOT preservado);
parent shape->null preservado; blend mode (Screen) e 3D preservados;
timing ancorado no playhead; ordem de empilhamento igual à origem.
Style Presets da aba Captions: round-trip sem regressão.

**Limitação conhecida (fica pra terminar):** **Layer Styles** ainda não
transferem -- `ADBE Layer Styles` rejeita `addProperty` do jeito
genérico ("neither an INDEXED_GROUP nor a text animator property group"),
precisa de um force-add especial (como os text animators já têm em
`STYLE_PRESET_FORCE_ADD_MATCHNAMES`). **Footage/precomp:** puladas com
aviso -- Fase 2 (copiar o arquivo-fonte junto do preset) não foi feita
neste passo.

### Kit preset: consistência 1:1 -- estado ligado/desligado (stroke, efeito, ...)

Bug reportado: um shape com o **stroke desligado** (o "olho" na Timeline)
voltava LIGADO ao virar preset. Causa: `captureStyleNode` nunca gravava
`PropertyBase.enabled`, e `applyStyleChildren` recria todo filho indexado
com `addProperty(matchName)`, que sempre vem LIGADO -- então o stroke era
capturado (cor/espessura) mas o "desligado" era perdido, e o re-add o
reativava. Mesma classe de bug pra efeito/máscara/text animator/layer
style desligados.

**Correção** (`captureStyleNode` + `applyStyleChildren`, host.jsx): grava
`node.enabled = false` quando a propriedade está desligada (só quando
`false` -- o padrão é ligado, então templates antigos sem o campo não
mudam), e reaplica `targetProp.enabled = false` DEPOIS de montar a
subárvore (desligar antes poderia atrapalhar o `addProperty` dos filhos).
Aditivo e seguro pros Style Presets. **Testado ao vivo**: shape com
stroke off + efeito off → capturados com `enabled:false`, recriados
`newStrokeEnabled:false` / `newFxEnabled:false`, e o fill (que estava
ligado) continua `true`.

### Kit preset: camadas de footage baseadas em arquivo (SVG, imagem, vídeo, áudio)

O "Preset layers" recusava qualquer camada de footage. Agora aceita as
que têm **um arquivo como fonte** (SVG, PNG/JPG, MP4/MOV, WAV/MP3...) --
só **pré-composições** continuam sem suporte (a fonte é uma comp inteira,
recursão fica pra depois).

Como funciona:

- **Captura** (`host.jsx` `kitAvSourceInfo`): `layerType: "av"` +
  `avSource = { kind:"file", originalPath, name, isStill, hasVideo,
  hasAudio }`. `buildKitLayerTemplates` só pula `av` SEM `avSource`
  (= precomp).
- **Salvar** (`panel.js` `copyKitPresetAssets`): copia cada arquivo-fonte
  pra `client/assets/kit-assets/<presetId>/` (irmão de `kit-previews/`) e
  grava só o basename em `avSource.assetFile`. Dedup por nome se duas
  camadas usam o mesmo arquivo.
- **Aplicar** (`panel.js` `withResolvedKitAssets` → `host.jsx`
  `kitImportOrReuseFootage`): resolve `assetFile` → caminho absoluto,
  reaproveita um item já importado com o mesmo path ou faz
  `app.project.importFile`, e `comp.layers.add(item)`. Depois aplica
  efeitos/transform/máscaras/flags/keyframes por cima, reancorados ao
  playhead -- mesma pipeline dos outros tipos. A prévia em vídeo também
  recebe o caminho resolvido.
- **Apagar preset**: `deleteKitPreviewFiles` remove `kit-assets/<id>/`
  junto com `<id>.mp4/.jpg`.

**Testado ao vivo** (SVG importado, com 2 keyframes de Scale + Gaussian
Blur, salvo e reaplicado numa comp nova com playhead != 0): capturado
como `av`/`file`; recriado como camada de footage com o mesmo SVG
(`source instanceof FootageItem`), efeito e keyframes preservados,
ancorado no playhead.

**Ainda pendente:** o **export** de um preset com footage é só o `.json`
-- o arquivo copiado NÃO viaja junto ainda (o painel avisa disso ao
exportar). Empacotar tudo num `.zip` pra compartilhar entre máquinas é o
próximo passo. **Pré-composições** também continuam puladas com aviso.

### Kit preset de footage: "Could not insert this preset" (fallback pro caminho original)

Um preset de SVG salvo enquanto o `panel.js` novo ainda não tinha
recarregado ficou com `avSource.originalPath` mas SEM `assetFile` (a
cópia não rodou). Ao aplicar, o host só olhava `avSource.absPath` →
`null` → 0 camadas → "Could not insert this preset.".

Correção:
- `host.jsx` `createLayerFromKitTemplate` (caminho `av`): usa
  `av.absPath || av.originalPath` -- na mesma máquina o arquivo original
  ainda serve como fallback.
- `panel.js` `withResolvedKitAssets`: se o preset tem `originalPath` mas
  não `assetFile`, faz `copyKitPresetAssets` na hora (migração preguiçosa)
  e grava o `assetFile` de volta no preset salvo; senão passa
  `absPath = originalPath`. O render da prévia tem o mesmo fallback.
- Confirmado ao vivo: aplicar um preset de SVG só com `originalPath`
  (sem `absPath`/`assetFile`) → `{ok:true, applied:1}`, camada de footage
  criada. Caminho com acento (`Usuário` / `Mótion Film Icons`) testado
  OK -- `File(path).exists` e `importFile` lidam com acento normalmente.

### Kit preset: export/import de footage empacotado (.zip) -- Fase 2 concluída (footage externo)

Presets com camadas de footage baseadas em arquivo agora **viajam entre
máquinas**: o export vira um `.zip` com `preset.json` + `preview.mp4/.jpg`
+ `assets/<arquivo>` (as cópias em `kit-assets/<id>/`). Preset sem footage
continua exportando `.json` puro (legível, o import antigo lê).

- **Zip STORE escrito à mão** (`panel.js`: `mfZipStore` / `mfZipRead` /
  `mfCrc32`) -- nenhuma lib externa é alcançável (CSP), e um zip sem
  compressão é simples: local file headers + central directory + EOCD,
  CRC32 tabelado, nomes UTF-8 (flag 0x0800). `saveBinaryFileWithNativeDialog`
  grava os bytes com Node `fs.writeFileSync` (não `cep.fs.writeFile`, que
  é só texto/base64). **Round-trip verificado ao vivo**: JSON com acento,
  5000 bytes binários e nome de arquivo acentuado voltam idênticos.
- **Import** (`importKitPresetsFromFileList`): lê o arquivo como
  `ArrayBuffer`, detecta zip pelos magic bytes `PK\x03\x04`. Se zip:
  desempacota pra `kit-assets/<id-novo>/` + `kit-previews/<id-novo>.*`,
  gera id novo, e tira o `originalPath`/`absPath` (vieram da outra
  máquina) deixando só o `assetFile` relativo. `.json` continua no
  caminho antigo (agora decodificado dos mesmos bytes com `TextDecoder`).
  Import de zip com preview embutido não re-renderiza a prévia.
- `index.html`: o `<input>` de import do Kit aceita `.zip` também.

**Ainda deferido:** **pré-composições** -- não são "footage externo",
são comps internas; recriar exige reconstruir a comp-fonte recursivamente
(com o footage aninhado também copiado). Continuam puladas com aviso.

### Kit preset: prévia de SVG/footage voltou (o "Error Code: 3" era estado ruim do AE)

Numa tentativa anterior eu tinha EXCLUÍDO camadas de footage do render da
prévia, achando que SVG na fila de render do AE causava "An unexpected
error occurred while exporting a composition. Error Code: 3". Testado ao
vivo depois: **SVG footage renderiza normal na fila** (comp com SVG,
plain e com Continuous Rasterize, ambos OK) -- o erro era a própria
mensagem do AE ("Please restart After Effects"): a engine de render tinha
entrado em estado ruim naquela sessão. Reiniciar resolveu.

**Revertido**: `generateKitPresetPreview` (panel.js) volta a resolver
`avSource.absPath` pro render da prévia, então SVG/imagem/vídeo aparecem
na miniatura. Mantido o retorno `{ ok:true, empty:true }` do
`renderKitPreviewClip` (host.jsx) como rede de segurança pro caso raro em
que `createLayerFromKitTemplate` devolve `null` pra TODAS as camadas
(ex.: preset só de pré-comp) -- aí o painel só mantém o placeholder sem
tratar como erro.

### Kit preset: "Undo group mismatch" depois de salvar um preset

Sintoma: depois de usar qualquer camada como base pra um preset, o AE
mostrava "After Effects warning: Undo group mismatch, will attempt to
fix." na primeira edição seguinte naquela camada -- mesmo com todo o
fluxo já concluído.

Causa: `renderKitPreviewClip` (host.jsx) chamava
`app.project.renderQueue.render()` DENTRO de um par
`app.beginUndoGroup()` / `app.endUndoGroup()`. O `render()` mexe na pilha
de undo do AE por conta própria (empurra/fecha seus próprios grupos);
envolvê-lo num grupo de script deixa a contagem de push/pop
desbalanceada, e o AE só reclama disso na ação de undo seguinte.

Correção: a comp descartável + o item da fila de render são montados
dentro de um grupo `"Mótion Film: Render Kit preview"`, o grupo é
**fechado com `app.endUndoGroup()` ANTES** do `render()`, o `render()`
roda **fora de qualquer grupo**, e a limpeza (`rqItem.remove()` +
`tempComp.remove()`) acontece num segundo grupo pequeno
`cleanupPreview()`. Regra geral: nunca embrulhar `renderQueue.render()`
em `beginUndoGroup`/`endUndoGroup`.

### Kit preset: "One footage file was saved as missing" ao salvar o projeto

Sintoma: depois de gerar a prévia de um preset que tem footage externo
(SVG/imagem/vídeo), o AE avisava "One footage file was saved as missing
because it couldn't be located" no próximo save do projeto.

Causa: o render da prévia (`renderKitPreviewClip`, caminho `"layers"`)
monta uma comp descartável e, pra isso, **importa o arquivo de footage
no projeto** (`kitImportOrReuseFootage`). Ao apagar a comp descartável no
`cleanupPreview()`, o item de footage importado ficava **órfão** no
projeto. Se o arquivo-fonte daquele órfão sumisse/mudasse de lugar
depois, o AE marcava como "missing" e avisava no save.

Correção: `renderKitPreviewClip` tira um snapshot dos `id`s dos itens do
projeto **antes** de montar a comp; no `cleanupPreview()`, depois de
remover a comp, varre o projeto e remove todo `FootageItem` que **não
estava no snapshot** e cujo `usedIn.length === 0` (nenhuma camada usa).
Itens que já existiam (quando `kitImportOrReuseFootage` *reaproveita* um
footage do projeto em vez de reimportar) ficam protegidos pelo snapshot.
Órfãos criados **antes** dessa correção precisam ser limpos uma vez à
mão (Project panel → apagar o item "missing", ou File → Dependencies →
Remove Unused Footage).

## Changelog -- Kit "Preset layers" agora guarda pré-composições inteiras

Pedido do usuário: "ao selecionar camadas para criar o preset de camadas,
ele não guarda pré-comps. Apenas a ferramenta de fazer preset em
pré-composição guarda tudo. A ideia é que o de camadas também guarde as
pré-comps consigo."

Contexto: existiam dois caminhos bem diferentes. **"Preset comp"**
(`captureKitCompReference`/`applyKitCompData`) não é um preset de
verdade -- só lembra o NOME da comp ativa e, ao aplicar, procura uma comp
com esse nome no projeto atual e a reusa. Só funciona no mesmo projeto
("guarda tudo" só porque é literalmente o mesmo objeto, não uma cópia).
Já **"Preset layers"** (`captureKitLayerGroupFromSelection` /
`buildKitLayerTemplates`) sempre fez uma captura de verdade, recriável a
partir do JSON -- mas quando uma das camadas selecionadas era uma
pré-comp, `kitAvSourceInfo` devolvia `null` (só sabia lidar com footage
baseado em arquivo) e `buildKitLayerTemplates` simplesmente **pulava**
essa camada, com um aviso "N camada(s) pulada(s)".

**Correção**: `captureSingleLayerTemplate` (host.jsx) agora detecta
`layer.source instanceof CompItem` e, nesse caso, chama a nova
`captureKitCompFull(compItem, depth)`, que captura **recursivamente**
todas as camadas daquela pré-comp (cada uma através da própria
`captureSingleLayerTemplate` -- uma pré-comp dentro de outra pré-comp
funciona igual, até `KIT_MAX_COMP_DEPTH = 8` níveis, só como trava contra
um encadeamento patológico já que o AE proíbe uma comp conter a si mesma).
O resultado vira `avSource = { kind: "comp", compName, width, height,
pixelAspect, frameRate, duration, bgColor, layers: [...] }`.

Como as camadas de uma pré-comp precisam manter a posição **absoluta**
que tinham dentro dela (não "normalizada" pro início do grupo, que é o
comportamento certo pra um grupo de camadas soltas coladas no playhead),
`buildKitLayerTemplates` ganhou um parâmetro `keepAbsoluteTime` -- quando
`true`, o `offset` de cada camada fica relativo ao frame 0 da comp em vez
de relativo à camada mais cedo do grupo.

Na aplicação, `createLayerFromKitTemplate` ganhou o caminho `av.kind ===
"comp"`: a nova `createKitCompFromTemplate(av)` cria uma `CompItem` nova
(`app.project.items.addComp` com as dimensões/frameRate/duração/bgColor
capturados) e a popula chamando `applyKitLayerGroupList` de novo --
mesma rotina de criar-e-reparentar que o "Preset layers" de topo já usa,
só que apontada pra essa comp nova em vez da comp ativa. Isso é
recursivo por construção: se uma pré-comp capturada tinha ela mesma uma
pré-comp dentro, `createLayerFromKitTemplate` cai de novo nesse mesmo
caminho ao recriar aquela camada. (Aninhar `beginUndoGroup`/`endUndoGroup`
assim é seguro -- é só um contador; o problema documentado acima era
`renderQueue.render()` especificamente, não undo groups aninhados.)

Como cada aplicação sempre cria uma comp **nova** (não existe uma forma
confiável de "reaproveitar por nome" como existe pra footage por caminho
de arquivo), aplicar o mesmo preset duas vezes gera duas cópias da
sub-comp -- o mesmo que aconteceria duplicando a pré-comp à mão.

**Footage dentro da pré-comp** (SVG/imagem/vídeo/áudio aninhado) precisa
do mesmo tratamento de cópia que já existia pro caso simples -- `panel.js`
ganhou um `walkKitAvSources(layers, visitFile)` que anda pela árvore
inteira (entrando em `avSource.layers` sempre que `avSource.kind ===
"comp"`) e é usado agora por `copyKitPresetAssets`, `withResolvedKitAssets`
(+ o novo `copyKitAssetFilesInto` pra persistir o `assetFile` migrado de
volta no `localStorage`, andando nas duas árvores em paralelo),
`kitPresetHasAssets`, `generateKitPresetPreview` e na limpeza de
`originalPath`/`absPath` do import de `.zip`. Antes, todas essas funções
só olhavam o array `layers` de primeiro nível.

**`renderKitPreviewClip`** (a prévia em vídeo) também ganhou um ajuste:
como a prévia agora pode criar `CompItem`s novas além de `FootageItem`s
pra montar a comp descartável, o "reaper" de órfãos do `cleanupPreview()`
(ver seção acima) passou a varrer `CompItem` também, e roda em **loop até
estabilizar** (até `KIT_MAX_COMP_DEPTH + 2` voltas) -- numa pré-comp
aninhada, o filho só fica "sem uso" depois que o pai é removido numa
volta anterior, então uma única passada não bastava pra desfazer vários
níveis.

**Testado ao vivo** via a ponte de debug: comp `MF_TEST_INNER` (um solid
animado começando em 0.5s + um shape com fill) usada como pré-comp dentro
de `MF_TEST_OUTER`; capturado com `captureKitLayerGroupFromSelection` →
`avSource.kind` veio `"comp"`, `avSource.layers` com as 2 camadas certas
(`offset` do solid = `0.5`, batendo com o `startTime` original -- prova
que o `keepAbsoluteTime` funciona). Aplicado numa comp nova via
`applyKitLayerGroupData` → criou 1 camada de pré-comp, a `CompItem` nova
saiu com `640x360`, `4s` de duração e as 2 camadas certas, o solid com
`inPoint = 0.5` preservado. 3 ciclos de `beginUndoGroup`/edição/
`endUndoGroup` depois disso completaram sem o aviso de "Undo group
mismatch". Comp original (`MF_TEST_OUTER`) ficou com 1 camada só -- sem
poluição.

**Não coberto ainda**: mattes/expressões que referenciam a pré-comp por
nome de fora dela (ex.: `comp("MF_TEST_INNER")` numa expressão em outra
camada) não são reescritas -- a comp recriada tem o mesmo nome, então uma
expressão desse tipo dentro do PRÓPRIO grupo capturado ainda funciona,
mas uma referência externa ao grupo, não.

## Changelog -- correção: ordem invertida + Track Matte deslinkado em "Preset layers"

Feedback do usuário logo depois de testar a captura de pré-comps acima:
"a ordem das camadas vem invertidas dentro da pré-comp... toda seleção de
cópia deve começar de cima para baixo" e "camadas como máscara Track Matte
foram deslincadas".

**Causa raiz (confirmada ao vivo, não foi um chute):** `comp.selectedLayers`
-- usado por `captureKitLayerGroupFromSelection` pra pegar a seleção atual
-- devolve os layers na ordem em que foram **selecionados/clicados**, não
na ordem de empilhamento (stacking) do Timeline. Testado diretamente: numa
comp com "Texto" no `layer(1)` (topo) e "pre-comp" no `layer(2)` (embaixo),
selecionar primeiro "pre-comp" e DEPOIS "Texto" (shift-clique de baixo pra
cima) fez `comp.selectedLayers` devolver `[pre-comp, Texto]` -- ordem
invertida em relação ao Timeline real. Como `buildKitLayerTemplates`
preserva a ordem de entrada e `applyKitLayerGroupList` recria assumindo que
essa ordem JÁ é a ordem de empilhamento (inclusive pra decidir quem é
"o layer logo acima" de cada um, na 2ª passada que liga Track Matte), uma
seleção feita de baixo pra cima gerava um preset com tudo trocado -- e,
como consequência direta, o Track Matte (que depende de adjacência
correta) ficava ligado ao layer errado (ou a nenhum).

Isso é uma limitação **do próprio `captureKitLayerGroupFromSelection`**
(o caminho de topo, usado desde que "Preset layers" existe) -- não é um
bug novo da captura de pré-comps: `captureKitCompFull`, que varre as
camadas de uma pré-comp via `compItem.layer(i)` (não via seleção), sempre
foi imune a isso. Só ficou visível agora porque o teste de pré-comp deste
usuário envolveu selecionar 2 camadas de uma vez ("Texto" + a camada de
pré-comp) na ordem "de baixo pra cima".

**Correção**: `captureKitLayerGroupFromSelection` (host.jsx) agora ordena
a seleção por `layer.index` (`layers.slice().sort(function(a,b){return
a.index - b.index;})`) antes de mandar pra `buildKitLayerTemplates` --
sempre topo-pra-baixo, não importa a ordem do clique. Testado ao vivo com
a MESMA seleção de antes (pre-comp clicado antes de Texto): a saída virou
`text:Texto / av:pre-comp`, batendo com o Timeline real.

**Presets já salvos com a ordem errada continuam errados** -- a correção
só vale pra capturas NOVAS; o JSON de um preset salvo antes dessa correção
já tem a ordem trocada gravada no `localStorage`. É preciso apagar e
salvar de novo (selecionar as camadas e clicar "Preset layers" outra vez)
pra gerar uma versão corrigida.

## Changelog -- cursor de texto pulando pro início: poll consolidado (tentativa 4)

O bug voltou de novo (4ª vez). As tentativas anteriores (itens 28, 29, 58
do HANDOFF) foram tirando/afinando leituras individuais do poll de 700ms
-- `layer.name` fora do `readLayerTransform`, throttle "1 em 4 ticks" no
`refreshTransform`/`refreshShape` -- mas nunca eliminaram: mesmo 1 em 4,
`readLayerTransform` (varredura completa de Position/Scale/Rotation/
Opacity) e `readShapeLayer` (que faz `layer.property("ADBE Root Vectors
Group")` na camada de texto ativa antes de desistir) continuavam batendo
no main thread do AE a cada ~2.8s enquanto o usuário digitava no viewport
-- e `refreshEffectsManager` (`getSelectedLayersEffects`, que anda o
Effect Parade e lê `effect.name`) rodava a **cada 700ms sem throttle
nenhum** sempre que a aba Effects Manager estava aberta.

**Abordagem nova -- um poll consolidado (`pollTick` em panel.js):**

- Todo tick de 700ms faz **UMA** chamada barata: `getSelectionSummary()`
  (host.jsx, nova) -- só checa se `activeItem` é comp, quantas camadas
  estão selecionadas, o `.index` da primeira e se ela é `instanceof
  TextLayer`. **Nada** de `.name`, `.value`, `.property(...)` ou
  varredura de transform/efeitos.
- Só escala pras leituras pesadas (`refreshTransform` + `refreshShape` +
  `refreshText` + `refreshEffectsManager`) quando a seleção **mudou** ou
  **não é** uma camada de texto.
- Enquanto a seleção é a MESMA camada de texto e o doc dela já está
  carregado (`textState.doc !== null`) -- ou seja, o usuário quase
  certamente está digitando nela no viewport -- essas leituras pesadas
  são **puladas por completo** (não "1 em N", zero). `refreshText` ainda
  é chamado mas se auto-bloqueia pela layer key, então não faz chamada
  nenhuma ao host nesse caso.
- `forceFullRefresh()` roda uma varredura completa quando o painel ganha
  foco (`window` `"focus"`) ou o mouse entra nele (`document`
  `"mouseenter"`, com debounce de 400ms) -- momentos em que o usuário
  comprovadamente NÃO está digitando no viewport, então é seguro pôr tudo
  em dia de uma vez.

Os guards `likelyEditingText` + `TRANSFORM_TEXT_POLL_DIVISOR` dentro de
`refreshTransform`/`refreshShape` ficaram como estão (defesa extra pras
~30 chamadas `refreshX(true)` espalhadas -- todas passam batido pelo
guard via `!force` -- e pro caso raro do `pollTick` e do guard
discordarem).

**Trade-off aceito:** com uma camada de texto selecionada e estável, o
painel Transform não atualiza sozinho (ex.: fazer scrub da timeline com
texto animado por keyframe selecionado). Volta a atualizar no instante em
que o mouse entra no painel ou ele ganha foco, e uma vez na hora que a
camada é selecionada. A prioridade explícita do usuário é **parar o
cursor de pular**; a atualização ao vivo do Transform pra camada de texto
é secundária e fácil de reafinar depois se incomodar.

`getSelectionSummary` testado ao vivo (texto selecionado →
`{count:1,index:2,isText:true}`; shape → `isText:false`). O teste de "o
cursor parou de pular?" precisa de digitação real no viewport -- pediu-se
ao usuário pra fechar/reabrir o painel (panel.js mudou, `$.evalFile` só
recarrega host.jsx) e confirmar na prática.

**Se ainda pular** mesmo com só o `getSelectionSummary` rodando por tick:
aí o próprio `comp.selectedLayers`/`.index` é o culpado, e o único
caminho seria não pollar nada durante a edição e trocar a detecção de
mudança de seleção por um evento CEP -- mas essa ponte só se atravessa se
essa tentativa falhar.

## Changelog -- cor de fundo influencia as "janelas" (caixas/cards)

**Problema:** o seletor de aparência tinha 2 cores (Accent e Panel), mas
Panel só trocava `--panel` (o fundo da extensão). As caixas -- `.section`,
linhas, campos, popovers, footer -- usam `--panel-raised` / `--panel-soft`
/ `--panel-deep`, que ficavam **fixos** no CSS. Resultado: mudar o fundo
não mexia nas caixas, e um fundo mais claro que `#2c2c2c` deixava as
caixas mais escuras que o fundo (invertido).

**Agora:** a família `--panel*` inteira é **derivada** da cor escolhida,
em tempo de execução:

- `client/shared-core.js`: `MF.color.mixHex(a, b, t)` (blend linear de
  dois hex) + `MF.color.panelShades(hex)` / `MF.color.applyPanelShades
  (rootStyle, hex)`. As caixas ficam **levemente** mais claras que o
  fundo (`--panel-soft` +2% rumo ao branco, `--panel-raised` +4%), os
  poços recuados um passo mais escuros (`--panel-deep` +28% rumo ao
  preto). O passo é proporcional, então funciona com fundo quase preto ou
  já clareado.
  - **Feedback do usuário (1ª passada):** os passos estavam grandes
    demais -- num fundo quase preto (`#080808`), +7% até o branco vira um
    salto absoluto grande (`#191919`, ~3x o valor do fundo). Baixado de
    0.04/0.07 pra 0.02/0.04, então os cards leem como "só um degrau",
    não como uma cor diferente.
- `client/panel.js`: `applyPanel()` e o botão "Reset colors" agora chamam
  `applyPanelShades` em vez de só setar `--panel`.
- `client/palette.js`: `applyTheme()` da janela satélite Paleta usa a
  mesma derivação, então as caixas dela seguem o mesmo tom.
- `client/styles.css`: os literais de `:root` viraram só o fallback de
  primeiro paint pro default `#212121` (`--panel-deep #181818`,
  `--panel-raised #2a2a2a`, `--panel-soft #252525`), em passo com a
  derivação.
- `?v=` de `index.html` e `palette.html` -> `0946b` (mudou
  `shared-core.js`/`panel.js`/`palette.js`).

**Sobre "não muda em tempo real":** verificado ao vivo pela ponte de
debug (porta 8092) que `applyPanelShades` atualiza `--panel*` E o
`background-color` computado dos `.section-tab` **na hora**, sem reabrir
o painel -- o caminho do swatch (confirmar cor -> `applyPanel(hex, true)`)
funciona. O que NÃO existe é preview enquanto se arrasta dentro do
seletor de cor: o picker nativo do AE (`pickColorNative`, via
`executeCommand(2240)`) é um diálogo modal que **devolve o valor UMA vez,
no OK** -- não um stream (limitação já documentada na seção "Color
picker: passou a usar o seletor NATIVO", anterior a esta mudança). Com o
fundo quase preto + cards agora quase da mesma cor, um ajuste pequeno de
cor rende uma mudança pequena de verdade -- some o contraste fixo
card-vs-fundo que antes servia de pista de "mudou". Se quiser preview ao
vivo enquanto arrasta, o caminho seria trocar os 2 swatches de Appearance
por `<input type="color">` HTML nativo (dispara `input` contínuo) -- a
estilização `.settings-popover input[type="color"]` em `styles.css` é
resquício dessa versão antiga; falta confirmar se o diálogo de cor do
`<input>` abre dentro do CEP neste build.

## Changelog -- "Null from selection": re-parenta camadas já linkadas + centro em espaço de comp

**Feedback do usuário:** o botão de nulo controlador (rodapé da Home,
`createShapeNull` em `host.jsx`) não mexia em camadas que já tinham pai
-- só parenteava as soltas. Pedido: toda camada selecionada segue o nulo
novo, **independente de já estar linkada a outra**.

- **Re-parent incondicional:** o loop de parenting tinha um guard
  `&& !layers[p].parent` (só camada sem pai). Removido -- agora toda
  camada selecionada (menos o próprio nulo) recebe `layers[p].parent =
  created`, substituindo o vínculo anterior. O setter `.parent =` (não
  `setParentWithJump`) recalcula o transform do filho, então ele **não
  pula** de lugar ao trocar de pai.
- **Centro no espaço da composição:** o centro do nulo era a média de
  `layer.property("ADBE Position").value` -- que pra camada parenteada é
  a posição *relativa ao pai*, não onde ela está na comp. Agora, como
  essas camadas passam a ser re-parenteadas de fato, isso deixaria o
  nulo fora do lugar. Nova função `layerWorldAnchor(layer)` sobe a
  cadeia de pais compondo Position/Scale/Rotation (2D) de cada ancestral.
  Pra camada sem pai o resultado é idêntico ao valor de Position, então
  o caso comum não muda.
- **Testado ao vivo** (ponte de debug 8092, comp scratch criada/destruída
  via script):
  - camada parenteada a `OLD_PARENT` → depois do clique, `parent = Null 1`; solta → idem; contador `parented` conta as duas.
  - com `OLD_PARENT` em escala 200% e o filho em Position (10,20) local,
    o nulo nasceu em (260,170) -- exatamente a média dos anchors das duas
    camadas em espaço de comp.
  - regressão: duas camadas soltas em (100,100) e (300,300) → nulo em
    (200,200), igual a antes.
- Só `host/host.jsx` mudou -- recarrega sozinho ao reabrir o painel (ou
  `$.evalFile`); nenhum `?v=` de client pra subir.

## Changelog -- barra de ações (footer) com altura ajustável ao arrastar

**Feedback do usuário:** o tamanho das barras de botões no rodapé das
abas Home e Kit incomodava; queria arrastar pra ajustar, igual ao
resizer da lista de categorias do Kit.

- **`client/index.html`:** um `<div class="footer-resizer">` como
  primeiro filho de cada `<footer class="footer">` (Home + Kit),
  `role="separator"` / `aria-orientation="horizontal"` / `tabindex="0"`.
- **`client/styles.css`:**
  - `.footer` ganhou `position: relative` + `height: var(--footer-h,
    auto)`. Sem a variável setada -> `auto`, ou seja, a altura de
    conteúdo de sempre (nada muda até arrastar). `align-items` foi de
    `center` pra `stretch`.
  - `.footer-actions` também `align-items: stretch`; `.footer-button`
    trocou `height: 38px` por `height: 100%; min-height: 38px` -- fica
    nos 38px de antes na altura natural, e cresce pra preencher quando a
    barra é arrastada pra cima.
  - `.footer-resizer`: faixa absoluta de 9px encostada na borda de cima
    do footer, `cursor: ns-resize`, com um `::after` que vira uma linha
    accent no hover/foco/drag (transparente em repouso -- a borda do
    footer já marca a divisa).
- **`client/panel.js`:** `initFooterResizer()` (chamado no `init()`) lê
  `motionfilm-footer-height` do localStorage e, pra cada handle, liga
  `wireFooterHandle()` -- pointerdown/move/up no mesmo molde do
  `initKitResizer`, só que no eixo Y (arrastar pra cima = mais alto).
  Home e Kit **compartilham** uma única `--footer-h` em `:root`; `main` /
  `.kit-layout` são `flex:1` e devolvem o espaço. Setas ↑/↓ ajustam em
  6px. Limites `FOOTER_MIN` 42 / `FOOTER_MAX` 120.
- **Testado ao vivo** (ponte de debug 8092, painel recarregado via
  `location.reload()`, eventos de ponteiro sintéticos no handle):
  altura default intacta (footer 55px / botão 38px); arrastar pra cima
  30px→60px levou o footer a 85→115px, o `main` encolheu na mesma medida,
  os botões cresceram pra 98px, e `115` foi persistido; arrastar pra
  baixo além do limite parou em 42px (`FOOTER_MIN`).
- `?v=` de `index.html` e `palette.html` -> `0947a`.

## Changelog -- janela satélite "MF - Camadas" + toggle no painel principal

**Pedido:** poder tirar os 3 botões de camada (Null / Camada de ajuste /
Sólido) do rodapé do painel principal e usá-los numa janela separada,
com o principal escondendo os próprios botões enquanto isso.

Seguimos a **abordagem do toggle explícito** (não auto-detecção de
"janela aberta" -- discutido: no CEP deste build `AutoVisible` é forçado
`true`, então a janela sempre existe, e painel visível-sem-foco não pode
sondar o host por causa do bug do cursor de texto).

- **`CSXS/manifest.xml`:** 3ª `<Extension Id="com.motionfilm.layers">`,
  clone estrutural da Paleta (mesmo `ScriptPath`, `AutoVisible` true,
  `styles.css` compartilhado). `<Menu>` = "MF - Camadas"
  (as satélites usam o prefixo curto "MF -"; só o principal fica
  "Mótion Film"). **Exige reiniciar o AE** pra registrar (CEP lê o
  manifest só no startup).
- **`client/layers.html` / `layers.css` / `layers.js`** (novos): shell
  mínimo no molde do `palette.html` (canvas keep-alive, toast). Os botões
  reusam as classes `.footer` / `.footer-button` do painel principal.
  `#layers-main` (hint) e `#layers-actions` (os botões) são irmãos, cada
  um `flex:1` -- **exatamente um é mostrado e ele preenche a janela
  inteira** (sem faixa vazia acima dos botões; feedback do usuário depois
  que o botão "trazer de volta" foi removido). **Não tem controle de
  ligar/desligar** -- isso vive só no popover Settings do principal.
  `initSync()` faz um `pull()` incondicional no load (o estado é a razão
  de ser da janela e não tem cache local; um hostCall no load não tem
  risco real do bug do cursor), depois passa a sondar só com foco.
- **`host/host.jsx`:** `setAuxLayersEnabled(json)` / `getAuxLayersEnabled()`
  no mesmo canal do tema (`$.global.__mfAuxLayers`, por sessão do AE).
- **`client/index.html` + `styles.css`:** o popover `•••` virou "Settings"
  (era "Appearance") e ganhou uma linha com um `.mf-switch` (visual do
  `.effects-master-toggle`) + nota explicativa.
- **`client/panel.js`:** `initAuxLayers()` lê `motionfilm-aux-layers` do
  localStorage, aplica (esconde `#page-home > .footer` quando ligado) e
  re-semeia o global do host (o principal é o único que escreve o estado,
  então não precisa de poll nem de reconciliação de volta).
- **Testado ao vivo** (ponte 8092): host `set/get` com forma objeto,
  bare e `false`, sem afetar o tema; no principal recarregado, o toggle
  alterna `aria-checked`, esconde/mostra o footer da Home, persiste
  `motionfilm-aux-layers` (0/1) e empurra `enabled` pro global. A janela
  satélite em si só dá pra testar depois de reiniciar o AE.
- `?v=` de `index.html` / `palette.html` / `layers.html` -> `0948d`.
- **Layout da satélite verificado ao vivo** (ponte 8094, janela real do
  usuário com ~68px de altura): estado "ligado" -> `#layers-actions`
  ocupa `y:0 h:68` (faixa vazia acima = 0), os 3 botões preenchem a
  altura (`h:52` cada); recarregada sem foco, o `pull()` do load já
  resolve pro estado certo (buttons aparecem sem precisar clicar).
- **Nomes das satélites encurtados** (feedback: nomes longos demais na
  aba/menu do AE): `<Menu>` + `<title>` de "Mótion Film — X" para
  **"MF - X"** (`MF - Paleta de Cores`, `MF - Camadas`).
  Só o painel principal continua "Mótion Film". Muda a aba/menu do AE ->
  **exige reiniciar o AE** (o manifest só é lido no startup).

## Changelog -- aba Icons: erro "Could not download this icon" (rate limit do Iconify)

**Sintoma (feedback do usuário):** ao importar um SVG na aba Icons, toast
"Could not download this icon." Alguns previews da grade também vinham
quebrados.

**Causa (confirmada ao vivo pela ponte 8092):** `api.iconify.design`
**limita requisições por IP (HTTP 429)**. A grade renderizava cada tile
com um `<img src="…iconify…/icon.svg">` na hora -- uma busca podia
disparar 64+ requisições `.svg` de uma vez, estourava o limite, e aí o
endpoint devolvia uma página HTML de 429 pra tudo (inclusive pro clique
de import seguinte). O `fetch` do import via `!response.ok` e jogava a
mensagem genérica.

**Correção (`client/panel.js`, aba Icons):**
- **Previews preguiçosos + com throttle:** `<img>` guarda a URL em
  `data-src`; um `IntersectionObserver` (root = `#icons-grid`, margem
  200px) só enfileira o tile quando ele chega perto da viewport, e uma
  fila (`pumpIconPreviews`) libera no máximo `ICON_PREVIEW_BATCH` (5) a
  cada `ICON_PREVIEW_INTERVAL_MS` (180ms) ~= 28/s em vez de 64 de uma
  vez. `resetIconPreviewQueue()` limpa a fila a cada nova busca; o
  observer é `disconnect()`ado antes de recriar a grade (senão segura os
  `<img>` antigos vivos pra sempre).
- **Cool-off de 429:** qualquer 429 (preview ou import) chama
  `noteIconRateLimit()` -> ~1 min sem buscar nada novo + um toast claro
  ("Iconify is rate-limiting requests... wait about a minute").
- **Retry:** cada preview tenta de novo 1x (delay 1.5-4s com jitter) e
  depois some (`visibility:hidden`, sem o glifo de imagem quebrada). O
  import tenta 1x de novo depois de 2.2s num 429; falha final mostra a
  causa real (`HTTP <status>`, offline, ou o texto do rate limit) em vez
  de "Could not download this icon.".
- Testado ao vivo com o endpoint realmente em 429: preview carrega
  15 -> 55 em ~3s (progressivo, não em rajada); o clique de import agora
  mostra a mensagem de rate limit e reabilita o tile.
- `?v=` de `index.html` / `palette.html` / `layers.html` -> `0948f`.

## Changelog -- removidas as seções responsivas de Text e Shape da aba Home

**Pedido do usuário:** essas seções (02/TEXT, 04/SHAPE contents, 05/SHAPE
props) foram feitas pra editar propriedades sem soltar o painel, mas o
painel de Propriedades nativo do AE sempre abre por cima ao selecionar
camadas, então elas ficaram obsoletas. **03/LAYER (Transform) fica** --
ele continua útil e o usuário pediu pra manter.

Limpeza completa (HTML + panel.js + host.jsx + CSS), testada ao vivo pela
ponte de debug.

- **`client/index.html`:** removidos `#text-props-section`,
  `#contents-section`, `#shape-props-section`. A `<main>` da Home agora só
  tem `01 / CURVES` e `03 / LAYER`.
- **`client/panel.js`** (~1400 linhas fora): todo o bloco de Shape
  (`SHAPE_SPEC`, `shapeState`, `commitShape`, árvore de conteúdo,
  `refreshShape`, builders de linha) e de Text (`textState`,
  `TEXT_*_SPEC`, `commitTextField`, fill/stroke/kerning/justification,
  `refreshText`, `rebuildTextRows`, o font picker inteiro --
  `loadFontList` / `buildFontPicker` / `openFamilyPicker` /
  `openStylePicker` -- e o scale popover).
  - **Preservados por serem compartilhados:** `buildValueRow` /
    `readRowValues` (Transform usa), `hexToRgb` / `rgbToHex`
    (createShapeSolid), `buildChoicePicker` / `openChoicePicker` (Kit /
    Captions), `cpApi` / `createColorSwatch` (Appearance / Paleta).
  - **Throttle do poll do Transform:** dependia de `textState.doc` +
    `lastLayerKeyForText` (populados pelo `refreshText` que sumiu). Agora
    `readLayerTransform` devolve `isText` e o painel guarda um
    `selectionIsText` -- mesma lógica de "1 tick em
    `TRANSFORM_TEXT_POLL_DIVISOR` enquanto uma camada de texto está
    selecionada", sem depender do bloco de Text. `pollTick` /
    `forceFullRefresh` / `init` / `bindEvents` limpos das chamadas
    `refreshText` / `refreshShape`.
- **`host/host.jsx`** (~850 linhas fora): `readTextLayer` /
  `readTextLayerInner` / `setTextValue` / `setTextFont` /
  `toggleTextStopwatch` / `getInstalledFonts`, o cluster de conversores
  de enum de texto (`enumMember`, `*ToName` / `nameTo*`,
  `JUSTIFICATION_*`), `readShapeLayer` / `readShapeLayerInner` /
  `setShapeValue` / `toggleShapeStopwatch` / `setShapeGroupEnabled` e os
  helpers de shape que só eles usavam (`contentsOfGroup`,
  `resolveGroupByPath`, `buildShapeTree`, `shapeItemsOfGroup`,
  `enumValue`, `lineCap/lineJoin` conversores, `resolveShapeField`,
  `describeShapeProperty`) + as 11 linhas de `$.global.*`.
  - **Preservados:** `textPropertyOf`, `rootContentsOf`, `isShapeLayer`
    -- Style Presets e a janela Paleta ainda ramificam por "é camada de
    texto/shape". `readLayerTransform` ganhou `isText`.
- **`client/styles.css`:** fora `.tx-*`, `.s-row` / `.s-field` / `.s-*`,
  `.ct-*`, `.contents-tree` (+ as versões dentro do `@media`).
  Preservados `.t-*` (Transform), `.fp-*` (compartilhado), `.t-color`.
- **Testado ao vivo** (ponte 8092/8093): painel recarrega sem erro de JS;
  Home mostra só curves + layer; a seção Transform popula os valores da
  camada selecionada ao vivo (`Position` etc.); collapse/expand ok; grade
  de anchor (9 pontos) e `setAnchorPreset` ok; as 5 abas trocam sem erro;
  `applyPaletteColor` em shape/text/solid e `captureLayerStylePreset` em
  texto continuam `ok:true` depois do enxugamento do host.
- `?v=` de `index.html` / `palette.html` / `layers.html` -> `0949a`.

## Changelog -- aba Icons: limpar a busca zera tudo (e para o tráfego)

**Feedback:** depois de digitar na busca de ícones, o usuário sentia que
não dava pra "esvaziar" o campo -- a grade ficava carregada, e isso podia
estar alimentando o limite do Iconify.

- **`#icons-search` virou `type="search"`** (`index.html`) -> ganha o
  botão nativo de limpar (X), estilizado pro tema escuro em `styles.css`
  (`::-webkit-search-cancel-button`, que o Chromium renderiza quase preto
  por padrão).
- **Limpar o campo tem efeito imediato** (`panel.js`, handler do
  `input`): campo vazio chama `runIconSearch("")` na hora, sem os 400ms
  de debounce -> grade em branco na hora.
- **Parar de verdade o tráfego:** `resetIconPreviewQueue()` agora também
  incrementa um `iconPreviewGen` e desconecta o `IntersectionObserver`.
  Cada tile guarda a geração em que nasceu; o `setTimeout` de retry de
  preview checa `gen !== iconPreviewGen || !img.isConnected` e desiste.
  Sem isso, um `<img>` já removido do DOM continuava disparando request
  (setar `.src` num nó solto ainda vai na rede) por 1,5-4s depois de a
  grade ser limpa. `iconsGridMessage` ("Searching…"/erros) também passa
  por esse reset.
- **Testado ao vivo:** buscar "star" -> 64 tiles; limpar -> `tiles=0`
  imediatamente e ainda `0` cinco segundos depois (nenhum retry
  ressuscitou nada); sem erro de JS.
- `?v=` -> `0949b`.

## Changelog -- Kit "Preset layers": preview mira onde a animação está (não sempre o frame 0)

**Feedback (projeto real):** ao salvar camadas como preset na aba Kit, o
preview renderizava sempre os primeiros ~2,5s. Num projeto de verdade as
camadas selecionadas existem desde o frame 0 (um fundo/base que dura a
comp toda), mas a animação keyframada acontece segundos depois -- o
preview mostrava um quadro estático.

- **`host/host.jsx`, `renderKitPreviewClip` (kind `"layers"`):**
  - Nova `collectKitTemplateKeyTimes(template, out)` -- varre os node
    trees do template (transform / effects / animators / masks / camera /
    light) juntando todo `keyframes[].time` (tempo absoluto de comp, como
    capturado).
  - Depois de montar os templates, calcula `firstKey`/`lastKey` em tempo
    da comp descartável (`kf.time - minInPoint`, onde `minInPoint =
    layers[0].inPoint - layers[0].offset`, o mesmo shift que o
    `createLayerFromKitTemplate` aplica). A janela de render vira
    `[firstKey - 0.25s (pre-roll), lastKey + 0.35s (tail)]`, limitada a
    `KIT_PREVIEW_MAX_DURATION` (2,5s) e quantizada a frame. Só desloca do
    0 quando `winStart > 1 frame` -- entrada no início e presets sem
    keyframe seguem renderizando do 0.
  - `rqItem.timeSpanStart` deixou de ser fixo em 0; a comp descartável é
    dimensionada pra caber `timeSpanStart + timeSpanDuration`.
  - `renderKitPreviewClip` agora devolve `window: {start, duration}` no
    sucesso (diagnóstico; o painel ignora).
  - Nested precomp: keyframes de camadas dentro de uma pré-comp são
    ignorados de propósito (tempo em outra base).
- **Testado ao vivo** (ponte 8092, payloads sintéticos):
  - camadas 0-8s, kf em 3-5s -> janela `start≈2,77s dur=2,5s` (antes:
    0-2,5s, estático);
  - kf perto de 0 (entrada) -> `start=0` (inalterado);
  - sem keyframe, span 1,2s -> `start=0 dur=1,2s` (inalterado);
  - kf lá em 20-40s -> `start≈19,77s dur=2,5s` (pega o início da
    animação em vez de 2,5s de nada).
- Só `host.jsx` mudou -- recarrega no reabrir do painel / próximo AE.

## Changelog -- Curves: curva aplicada por segmento (keyframe compartilhada)

**Bug:** com 3+ keyframes selecionadas (A-B-C, B compartilhada entre os
dois segmentos), a curva não era obedecida: no Graph Editor o segundo
segmento começava já em movimento em vez de descansar no zero. Com
keyframes isoladas em pares (A-B, C-D) funcionava. O Motion 4 aplica a
curva em cada segmento separadamente.

- **Causa (`host/host.jsx`, `applyVelocityProfile`):** a velocidade de
  cada key era tirada do perfil em `i / (keys - 1)` -- a curva era
  "esticada" uma vez só sobre a seleção inteira. Com 3 keys a do meio
  caía no PICO da curva e recebia a velocidade média cheia nos dois
  lados. Com 2 keys os índices eram 0 e 1 (pontas = zero), por isso o
  caso simples funcionava.
- **Correção:** cada par de keys selecionadas consecutivas é um segmento
  próprio. O lado de entrada de uma key usa a velocidade do FIM da curva
  e o lado de saída usa a do INÍCIO (ambas zero no perfil do painel),
  com `inInfluence`/`outInfluence` respectivos. `profileValueAt` (sem uso)
  saiu; entrou `scaleSpeed` (o antigo `array * número` dava `NaN` em
  propriedades multidimensionais).
- Auto-bezier/continuous agora são desligados ANTES do
  `setTemporalEaseAtKey` (key continuous mantém os dois lados
  sincronizados); no modo `diamond` o continuous é religado depois.
- **Testado ao vivo** (comp `MF_TEST_SCRATCH`, criada e removida):
  Position e Opacity com keys em 0s/2s/7s, todas auto-bezier antes.
  Depois de aplicar (80/80): velocidade ~0 logo antes e logo depois da
  key de 2s, pico no meio de cada segmento (pos 1742 px/s em 1s, 398
  px/s em 4,5s). Modos `bezier` e `diamond` OK.
- Só `host.jsx` mudou -- recarrega no reabrir do painel / próximo AE.
## Changelog -- Null: Shift+clique no centro da comp + preserva parent existente

- **Shift+clique no botão Null** (painel principal e satélite "MF -
  Camadas"): o null nasce no centro da comp (`comp.width/2,
  comp.height/2`) em vez do centro dos anchor points da seleção -- útil
  pra escalar várias camadas em volta do meio do quadro. Timing e
  parenting iguais ao clique normal. `createShapeNull(rawOptions)` aceita
  `{ compCentre: true }`; sem argumento continua como antes.
- **Parent existente é preservado:** só camadas SEM parent são linkadas ao
  null novo. Uma camada que já segue outra mantém o link (a camada que
  ela segue normalmente também está na seleção e vai pro null, então a
  filha acompanha pela cadeia). Antes TODAS as selecionadas eram
  re-parenteadas, achatando o rig. Resposta ganhou `kept` (quantas
  mantiveram o parent) e `compCentre`; o status do painel mostra os dois.
- **Bug corrigido em `layerWorldAnchor`:** ignorava o Anchor Point do
  parent, então uma camada com parent entrava deslocada na média do
  centro. Agora `(pt - anchorDoParent) * escala, rotação, + posição`.
- Tooltips dos dois botões atualizados; `?v=` -> `0949c`.
- **Testado ao vivo** (comp `MF_TEST_SCRATCH`, criada e removida): A
  (300,300), B (700,500), C (900,700) com C filha de B, todas
  selecionadas. Clique normal -> null em (633.3, 500) = média correta das
  posições reais; A e B -> Null, C continua em B (posição local
  intacta). `{compCentre:true}` -> null em (960, 540), mesmo parenting.
  Sem argumento -> igual ao clique normal.
## Changelog -- Paleta de Cores: Shift+clique aplica a cor só no stroke

- **`client/palette.js`:** Shift+clique (ou Shift+Enter) num cubo manda
  `{ rgb, target: "stroke" }` pro `applyPaletteColor`. Clique normal
  inalterado (só fill). Tooltip e mensagens de status atualizados
  ("Stroke aplicado em N camadas. Stroke criado em M.").
- **`host/host.jsx`, `applyPaletteStroke`** (chamada por
  `applyPaletteColor` quando `target === "stroke"`):
  - **Shape:** recolore todo `ADBE Vector Graphic - Stroke` (recursivo,
    igual `setShapeFillColours`). Se a shape não tem nenhum stroke, cria
    um -- como Contents > Add > Stroke -- em cada grupo que desenha um
    path (Rect/Ellipse/Star/Path), logo ACIMA do primeiro fill do grupo
    (contorno por cima do preenchimento, mesma ordem das ferramentas de
    shape do AE). Sem grupo com path direto -> no Contents raiz. Alvos
    guardados como caminho de índices e re-resolvidos antes de cada
    `addProperty` (adicionar invalida referências irmãs).
  - **Texto:** `TextDocument.applyStroke = true` + `strokeColor`
    (largura 2 se estava 0).
  - **Outros tipos:** ignorados (não têm contorno nativo).
  - Cor com keyframes: grava key no playhead (`setColorValue`) em vez de
    `setValue`, que falharia.
- `?v=` -> `0949d`.
- **Testado ao vivo** (comp `MF_TEST_SCRATCH`, criada e removida):
  shape sem stroke (grupo Rect+Fill) -> stroke criado entre Rect e Fill;
  shape com stroke -> só recolorido, sem duplicar; stroke com keys ->
  key nova no playhead; path direto no Contents raiz -> stroke na raiz
  acima do fill; texto -> stroke ligado com a cor; sólido -> ignorado.
  Segundo Shift+clique não cria stroke duplicado; fills intocados; clique
  normal continua só no fill.
## Changelog -- Paleta: Shift+clique reativa stroke oculto

**Bug (print do usuário):** status "Stroke aplicado em 1 camada", mas nada
aparecia. Shape desenhada com o Stroke da barra de ferramentas em "None"
ainda ganha um "Stroke 1" -- só que com o olho de visibilidade desligado
(`enabled = false`, confirmado lendo a camada real). A cor era aplicada
nesse stroke invisível.

- `setShapeStrokeColours` agora liga (`enabled = true`) todo stroke que
  recolore e estava oculto; conta em `stats.enabled`, devolvido como
  `enabled` por `applyPaletteStroke`. Status da paleta: "N stroke(s)
  oculto(s) reativado(s)."
- `?v=` -> `0949e`.
- **Testado ao vivo** (comp `MF_TEST_SCRATCH`): grupo Rect + Stroke
  desligado + Fill -> depois do Shift+clique o stroke fica ligado, com a
  cor nova, sem stroke duplicado (`enabled: 1, added: 0`).
## Changelog -- Tamanho do marcador do Null nas Settings

- **Settings (popover `•••`)** ganhou "Tamanho do Null (px)"
  (`#null-marker-size`, 4-2000, padrão 44). Salva no `change`/Enter;
  status "Null size set to N px."
- **Persistência em `app.settings`** (seção `MotionFilm`, chave
  `nullMarkerSize`), não em `localStorage`: sobrevive ao reiniciar o AE e
  é o MESMO valor pro botão de Null do painel principal e da satélite "MF -
  Camadas" (cada janela tem o próprio `localStorage`). `setNullMarkerSize`
  chama `app.preferences.saveToDisk()` pra não depender de o AE fechar
  limpo. O painel lê o valor (`getNullMarkerSize`) ao carregar.
- `createShapeNull` usa `readNullMarkerSize()` no `Rect Size` do
  marcador (antes fixo em 44).
- CSS: `.settings-number-input`. `?v=` -> `0949f`.
- **Testado ao vivo:** valor inicial 44; set 150 -> lido de volta 150;
  set 1 -> clamp 4; null criado com 150 -> marcador `150,150`. Valor do
  usuário restaurado (44) no fim do teste.
## Changelog -- Settings mais compacto + toggle "MF - Camadas" lido certo no startup

- **Accent e Panel lado a lado** (`.settings-colors`, flex) em vez de
  empilhados -- popover mais baixo.
- **Removida a nota** abaixo de "Tamanho do Null (px)".
- **Bug: com "Botões de camada em painel separado" ligado, a janela "MF -
  Camadas" abria sem os botões depois de reiniciar o AE** (só voltava
  desligando/ligando o toggle). Causa: o estado vivia só em
  `$.global.__mfAuxLayers`, que começa vazio a cada launch e era semeado
  apenas quando o painel principal carregava. Se a satélite carregasse
  antes, lia "off" e, sem foco, nunca perguntava de novo (o polling só
  roda com a janela focada).
  - `host.jsx`: `setAuxLayersEnabled` também salva em `app.settings`
    (`MotionFilm` / `auxLayersEnabled`, `"1"`/`"0"`, com `saveToDisk`
    só quando muda); `getAuxLayersEnabled` lê de lá quando o global da
    sessão ainda está vazio. Ordem de carregamento das janelas deixa de
    importar.
  - `layers.js`: 3 pulls extras incondicionais no startup (1,5s / 4s /
    9s) -- cobrem o tema e o primeiro launch depois da atualização.
- `?v=` -> `0949g`.
- **Testado ao vivo:** set `true` -> salvo `"1"`; global apagado
  (simulando AE recém-aberto) -> `getAuxLayersEnabled` devolve `true`;
  mesmo pra `false`. Estado do usuário restaurado no fim.
## Changelog -- Curves: aplicar num segmento não mexe no vizinho não selecionado

**Bug:** A-B-C com curva nos dois segmentos; selecionando só B e C e
aplicando outra curva, o segmento A->B também mudava. O Motion 4 deixa
A->B intacto.

- **Causa (`applyVelocityProfile`):** toda key selecionada tinha os DOIS
  lados reescritos. O lado de entrada da primeira key selecionada (B) e o
  de saída da última pertencem a segmentos FORA da seleção -- recebiam
  velocidade 0,001 + a influência nova, remodelando o vizinho.
- **Correção:** só os lados virados pra outra key selecionada
  (`ownsIn = i > 0`, `ownsOut = i < last`) recebem a curva. Os lados de
  fora mantêm ease (lida ANTES de desligar auto-bezier, então o formato
  calculado é preservado) e tipo de interpolação. Vale também pro modo
  `hold`.
  - `exactEaseList`: recria a ease preservada sem o piso de 0,001 do
    `createEaseList` (velocidade negativa de propriedade 1D sobrevive).
  - `setTemporalEaseAtKey` converte um lado LINEAR em BEZIER (visto ao
    vivo) -- o tipo original do lado de fora é reaplicado depois.
  - Modo `diamond`: continuous só em keys com os dois lados selecionados
    (continuous iguala as velocidades e puxaria o lado de fora).
- **Testado ao vivo** (comp `MF_TEST_SCRATCH`): Position 0/1/2s, curva
  88/92 nos dois segmentos, depois 26/99 só em B-C -> A->B com velocidade
  idêntica antes/depois (`242,4412,280,13`), in de B mantém `0@88`;
  Opacity auto-bezier caindo -> in de B mantém `-50@17`; Rotation linear
  -> in de B continua LINEAR com 90°/s; diamond só em A-B -> B-C intacto
  e B sem continuous.
## Changelog -- Curves: keyframe contínua continua contínua

**Pedido:** aplicar curva transformava keyframe contínua (ampulheta /
auto-bezier) em ease comum. Velocidade ir a zero é aceitável; perder o
tipo contínuo não.

- `applyVelocityProfile`: `keepContinuous` = key era contínua (lido antes
  de qualquer mudança) e os lados de fora (se houver) são BEZIER.
  - **Key interna** (os dois lados selecionados): os dois lados vão pra
    velocidade zero da curva com as influências IN/OUT -- continua
    contínua (velocidades iguais).
  - **Key de borda** (um lado fora da seleção): o lado selecionado copia a
    VELOCIDADE do lado de fora (contínua = mesma velocidade dos dois
    lados), só a influência vem da curva -- segmento vizinho intacto.
  - `setTemporalContinuousAtKey(true)` no fim se `keepContinuous` (ou modo
    `diamond` em key interna, como antes). Auto-bezier continua sendo
    desligado (recalcularia as velocidades e destruiria a curva).
  - `exactEaseList(eases, influence)` ganhou a influência opcional.
- **Testado ao vivo** (Position 0/1/2s, key do meio contínua a 140 px/s):
  tudo selecionado -> `0@79 / 0@62 cont=true`; só B-C -> `140@33 /
  140@62 cont=true`, A->B idêntico; só A-B -> `140@79 / 140@33
  cont=true`, B->C idêntico; key comum -> segue `cont=false`; auto-bezier
  -> `cont=true auto=false`.
## Changelog -- Topo compacto: sem o nome "Mótion Film", versão ao lado do •••

- `index.html`: removido o `<h1>Mótion Film</h1>`. A `.topbar` agora é UMA
  linha só: `nav.page-tabs` à esquerda + `.topbar-tools` (`#version-tag` +
  `#settings-toggle`) à direita. Libera ~60px de altura em todas as abas.
- `styles.css`: `.topbar` vira a linha (flex, `border-bottom` que antes
  era da `.page-tabs`; a sublinha da aba ativa continua sobrepondo a
  borda via `margin-bottom: -1px`); `.page-tabs` `flex: 1; min-width: 0`;
  regras de `h1`/`.topbar-title` removidas. `.settings-popover` sobe de
  `top: 56px` pra `44px` (logo abaixo do botão). Breakpoint ≤320px
  ajustado pros novos seletores.
- `setStatus` já posiciona o toast pela base de `.page-tabs` -- segue
  funcionando sem mudança.
- Conferido num servidor estático local (400×700): linha com 40px de
  altura, botão `•••` em y 7-35, popover abrindo em y 44 alinhado à
  direita do botão. (`.claude/launch.json` -> `panel-static`, python
  http.server na pasta `client/`, pra checar layout fora do AE.)
## Changelog -- Card Curves: respiro de cima igual ao de baixo

- `.motion-row` (gráfico + grade de âncora, primeiro item do card) perdeu
  o `margin-top: 15px`, que somava com o `padding: 15px` da
  `.section-body` (30px em cima vs 15px embaixo). Medido no servidor
  estático: 15px em cima, 15px embaixo (+1px de borda), 15px nas laterais.
## Changelog -- Icons: lotes + cache em disco + espelhos (fim dos blocos vazios / 429)

**Problema:** às vezes as prévias ficavam vazias e o import falhava
("espere um tempo"). Causa: cada tile carregava o próprio
`<img src="api.iconify.design/<prefix>/<nome>.svg">` -- UMA requisição por
ícone, tudo no mesmo servidor. Uma busca rolada um pouco = 100+
requisições -> limite por IP do Iconify (HTTP 429) -> 1 min sem prévias
nem import. (Nada é carregado ao abrir a extensão: a aba só fala com o
Iconify quando se digita uma busca.)

- **Lotes:** os dados dos ícones vêm de `/<prefix>.json?icons=a,b,c`
  (uma requisição por prefixo, URL ≤ 450 chars, no máx. 2 em paralelo) e
  o SVG é montado localmente (`resolveIconData` + `applyIconTransforms`
  replicam `mergeIconData`/`iconToSVG` do @iconify/utils: aliases,
  hFlip/vFlip/rotate). Prévia = `data:` URI, sem rede.
- **Import sem rede:** usa os dados já em cache da prévia
  (`buildIconSvg(entry, "#ffffff", 512)` -- mesmo formato que o `.svg?
  color=&height=512` da API gerava). Só busca direto se clicado antes da
  prévia chegar.
- **Cache em disco:** `Documentos/Mótion Film Tools/icon-cache.json`
  (até 6000 ícones + 60 buscas, buscas expiram em 7 dias). Repetir uma
  busca, mesmo depois de reiniciar o AE, custa zero requisições. Não usa
  `localStorage` (não disputa cota com presets de Kit/Style). Só memória
  se o Node não estiver disponível.
- **Espelhos oficiais:** rodízio entre `api.iconify.design`,
  `api.simplesvg.com`, `api.unisvg.com` (mesmos dados, conferido ao
  vivo). 429 pausa só aquele host 60s (falha de rede: 15s) e o próximo
  assume; só quando os 3 estão pausados o painel espera -- e retoma
  sozinho, com toast dizendo quantos segundos (ou "sem internet" se o
  motivo for rede).
- Tiles sem `alt` (antes o nome do ícone aparecia escrito dentro do
  bloco enquanto carregava / quando falhava).
- `?v=` -> `0949h`.
- **Testado** (servidor estático, IntersectionObserver forçado a
  "tudo visível" = pior caso): "house", 64 tiles -> 64 carregados com 26
  requisições (1 busca + 25 lotes) divididas 9/9/8 entre os 3 hosts --
  antes 64 num host só. Repetir a busca -> 0 requisições. Host principal
  simulado com 429 -> 1 bloqueio, 24 requisições nos espelhos, 64/64
  carregados, nenhum toast de erro. Cache em disco só roda dentro do CEP
  (Node).
## Changelog -- Curves: funciona em Mask Path e Path de shape

- **Bug:** aplicar curva em keyframes de Mask Path / Path (shape layer)
  não fazia nada. `applyVelocityProfile` filtrava com `isNumericProperty`,
  e o valor dessas propriedades é um `Shape`, não número -- eram
  descartadas em silêncio, mesmo o AE aceitando ease temporal nelas.
- **Correção:** o filtro agora é `property.isInterpolationTypeValid(...)`
  (BEZIER, ou HOLD no modo hold) -- pega Mask Path, Path, e continua
  pulando o que só aceita HOLD (Source Text, etc.). `speedFor` devolve 0
  pra valores não numéricos (as pontas da curva já são velocidade zero,
  então é exatamente o que seria aplicado).
- **Testado ao vivo** (comp `MF_TEST_SCRATCH`): Mask Path com 3 keys
  lineares -> curva 79/62 aplicada (`0@79 / 0@62` na key do meio,
  lados de fora seguem LINEAR); Path de shape layer com 2 keys -> 30/90
  aplicada.
## Release v0.9.5 (pacote pro escritório)

- `ExtensionBundleVersion` + as 3 `<Extension Version>` -> `0.9.5`
  (manifest validado com parser XML); `#version-tag` -> `v0.9.5`.
- Pacote `motion-film-v0.9.5.rar` (raiz do projeto, ~590 KB): pasta
  `motion-film` + `INSTALAR.txt` + `habilitar-extensoes.reg`
  (PlayerDebugMode=1 em CSXS.9-16, HKCU).
- Fora do pacote: `.debug` (portas CDP 8092-8094, só desenvolvimento) e
  as mídias dos presets de Kit salvos pelo usuário
  (`assets/kit-assets/<id>/`, `assets/kit-previews/kit-*`) -- esses
  presets vivem no `localStorage` de quem os criou, então nas outras
  máquinas os arquivos seriam órfãos.
## Changelog -- Null: liga o topo da cadeia de parents (não ignora mais a camada)

**Antes:** camada selecionada que já tinha parent era pulada -- o null
nascia, mas ela (e a cadeia dela) não seguia o null quando o chefe da
cadeia não estava selecionado.

- `createShapeNull`: pra cada camada selecionada, sobe pela cadeia de
  `parent` até o topo (a camada que não segue ninguém) e liga ESSE topo
  ao null. Camada sem parent é o próprio topo (vai direto pro null).
  Links existentes nunca são trocados -- a cadeia inteira passa a
  obedecer o null. Várias selecionadas com o mesmo chefe ligam ele uma
  vez só (dedupe por `index`). Resposta: `kept` virou `chained` (quantas
  selecionadas seguem o null através da cadeia); status do painel e
  tooltips atualizados.
- `?v=` -> `0949i`.
- **Testado ao vivo** (comp `MF_TEST_SCRATCH`, posição real medida com
  `toComp(anchorPoint)` antes/depois):
  - B (rotacionada, NÃO selecionada) <- C (selecionada) <- D: B -> Null,
    C -> B, D -> C; posições na tela idênticas (500,500 | 700,600 |
    900,700).
  - A solta + C e E da mesma cadeia de B: A -> Null, B -> Null (uma vez),
    C -> B, E -> C (`parented 2, chained 2`).
  - Cadeia funda D -> C -> B, só D selecionada: B -> Null.

## Changelog -- janela satélite Mótion Figma Layers (v0.9.6)

Ferramenta nova pra trazer elementos do Figma pro AE com um clique (no
estilo dos dois primeiros botões do Overlord, implementação própria com
API pública do Figma e do AE):

- **Importar camadas**: frame vira composição; cada camada separada na
  posição do Figma; formas como shape layers editáveis (rect/elipse
  nativos, demais vetores como paths); textos editáveis com estilos
  mistos; frames que recortam viram precomps; grupos são achatados
  (só as camadas, sem Null de controle); máscaras viram track matte; sombra/blur viram Drop Shadow /
  Gaussian Blur. Itens soltos (fora de frame) entram na comp ativa.
- **Rasterizar**: cada item selecionado vira um PNG (1x a 4x), escala
  compensada na camada pra manter o tamanho do Figma.
- Os dois botões existem no plugin do Figma e na janela do AE (o AE pede,
  o plugin responde pela ponte local).

Arquivos: `client/figma.html|js|css` (janela + servidor local
`127.0.0.1:47811`), `host/figma.jsx` (construtor, carregado pela janela
via `$.evalFile`), `../figma-plugin/` (plugin do Figma),
`../installer/` (gera o `.exe` pros colegas). Manifesto: nova
`<Extension Id="com.motionfilm.figma">`, AutoVisible true (mesma regra
das outras satélites), debug na porta `8095`.

Limitações conhecidas desta primeira versão: gradientes e imagens vão
como PNG (as cores do Gradient Fill do AE não são acessíveis por script);
spread de sombra, inner shadow e background blur não têm equivalente
direto; grupos com modo de mesclagem não levam o modo (Null não
compõe); fontes que não estão instaladas no PC caem na fonte padrão (a
lista aparece no aviso do import).

Validado ao vivo no AE 26.5: o `code.js` real rodando contra um Figma
simulado (Node vm) -> `mflBuild` real -> render do frame conferido;
fluxo HTTP completo (push do Figma e pedido vindo do botão do AE) testado
contra o servidor rodando dentro do AE. Detalhes em `HANDOFF.md`.

## Changelog -- botão Null: inserido na hierarquia + 3D automático

Pedido do usuário, substitui a regra anterior ("o topo da cadeia de
parent passa a seguir o null"):

- **Null inserido no meio da hierarquia**: camada selecionada -> Null ->
  parent antigo da camada. A camada passa a seguir o Null novo, e o Null
  segue o que a camada seguia antes. Camada selecionada cujo parent
  também está selecionado não é mexida (continua seguindo o parent, que
  agora segue o Null). Se as camadas tinham parents diferentes, o Null
  segue o parent da maioria (empate: o da camada mais alta na timeline).
- **3D automático**: se alguma camada selecionada é 3D, câmera ou luz, o
  Null já nasce 3D, posicionado na posição real 3D (no mundo) da seleção.
  Calculado pelo próprio AE com uma expressão temporária de `toWorld()`
  lida e convertida em valor fixo (o `layerWorldAnchor` antigo é só 2D).
- Validado ao vivo (AE 26.5) em 4 cenários (2D com parent
  rotacionado/escalado, parent+filho selecionados, 3D sob parent
  rotacionado em Y, câmera): nenhuma camada sai do lugar no mundo.

## Changelog -- Kit vira biblioteca de Packs em disco (v0.9.7)

Pedido do usuário: a aba Kit deve funcionar como uma biblioteca própria
de cenas (estilo Motion Bro, mas pra copiar/colar camadas e comps entre
projetos, não pra efeitos). Quatro problemas resolvidos:

1. **"Preset comp" só funcionava no mesmo projeto** (guardava só o NOME
   da comp). Agora `kitCaptureToFile("comp")` captura a comp inteira
   (`captureKitCompFull`: todas as camadas, pré-comps recursivas, flags da
   comp) e o painel COPIA toda mídia usada pra pasta do pack. Aplicar
   (`applyKitPackFile`) reconstrói a comp e coloca na comp ativa no
   playhead (ou cria/abre, sem comp ativa).
2. **Previews pesadas**: o render usa resolução reduzida
   (`rqItem.setSettings({"Resolution":[f,f]})`, lado maior ~480px,
   `KIT_PREVIEW_MAX_SIDE`) -- 1920x1080 vira 480x270, 16x menos pixels.
   Testado: 4s pra uma comp com imagem, pré-comp e matte.
3. **Export leva TUDO**: `.zip` com `preset.json` (formatVersion 2) +
   `preview.mp4/jpg` + `assets/**` (imagens, vídeos, áudio, PSD,
   sequências). Escrito/lido em pedaços direto do disco
   (`kitZipWrite`/`kitZipOpen`/`kitZipExtract`, STORE, CRC32 próprio) --
   pack com vídeo de GB não carrega na memória. Limite: 4 GB por zip.
   Import pelo diálogo nativo (caminho real), aceita zips v1 também.
4. **Apagar pack apaga as mídias**: cada pack é uma pasta; apagar pack ou
   tópico remove a pasta inteira.

**Armazenamento novo** (`Documentos\Mótion Film Packs\`): `library.json`
(ordem dos tópicos) + `packs/<id>/{meta.json, data.json, preview.*,
assets/}`. Fora da pasta da extensão de propósito (reinstalar apaga a
pasta da extensão). `localStorage` não é mais usado pros packs.

**Aplicar copia a mídia pra junto do projeto** (`<pasta do .aep>/Pack
Assets/<pack>/`; projeto não salvo: `Documentos\Mótion Film Packs\
_Unsaved projects\<pack>\`) -- o projeto nunca aponta pra biblioteca,
então apagar o pack depois não quebra projeto nenhum.

**Mídia tratada na captura** (`kitAvSourceInfo`): arquivo comum; sequência
de imagens (copia todos os frames, importa com `sequence`); camada de PSD/
AI importado em camadas (`bake`: salva só aquela camada como PNG via
`kitBakeFootageItem`, porque reimportar o arquivo daria a imagem mesclada);
placeholder/mídia faltando (vira placeholder do mesmo tamanho/duração);
interpretação (alpha, fps conformado, loop) reaplicada. Track matte agora
guarda QUAL camada é a matte (`trackMatteTemplateIndex` +
`setTrackMatte`) -- antes só funcionava com a matte logo acima.

**Testado ao vivo (host)**: comp com imagem animada, texto, sólido com
matte NÃO adjacente, shape e pré-comp com outra imagem rotacionada ->
captura -> cópia -> preview 480x270 -> apagadas a comp, a mídia do
projeto e os ARQUIVOS ORIGINAIS do disco -> aplicado numa comp nova no
playhead 1s: tudo reconstruído com a mídia da pasta do pack, matte certo,
pré-comp com a rotação, organizado em Project > Mótion Film Packs > pack.
Zip: round-trip byte a byte de 22 MB + nomes acentuados, e o
`Expand-Archive` do Windows abre o arquivo gerado.

**Não migrado**: os presets antigos do `localStorage` (a pedido do
usuário, o único era de exemplo).

### Correção logo em seguida: os dois botões usam SÓ as camadas selecionadas

Regra do usuário (a primeira versão acima estava errada: "Save Comp"
capturava a comp ativa INTEIRA). Agora:

- **Save Layers as Pack**: as camadas selecionadas; aplicar cola elas
  soltas na agulha.
- **Save Comp as Pack**: as MESMAS camadas selecionadas; aplicar cria UMA
  comp nova com elas (como Pre-compose: tamanho/fps da comp de origem,
  começando na camada mais cedo, nome = nome do pack) e coloca na agulha.
- **Preview**: só as camadas salvas, nos dois tipos (comp temporária do
  tamanho da original, janela mirando os keyframes).
- Dependências entram sozinhas: o parent (cadeia toda) e a track matte de
  uma camada selecionada, se não estavam selecionados -- sem eles a
  camada perderia o movimento/recorte. O status avisa quantas entraram.
- Preview com qualidade Draft e sem motion blur (só a miniatura).

**Por que mudou além da regra**: a versão "comp inteira" travou o AE do
usuário por 10+ min renderizando a preview de uma comp 2160x3840 com 216
camadas e 206 efeitos (render da Render Queue não pode ser interrompido
por script). `captureKitCompFull` continua existindo só pras pré-comps
DENTRO da seleção.

### Dois bugs reais da preview, achados ao vivo no projeto do usuário

1. **`renderQueue.render()` renderiza a FILA INTEIRA, não só a preview.**
   O usuário tinha a comp real dele (4K, 14s) marcada na Render Queue --
   cada preview renderizava ela junto (107s numa preview de 6 camadas, e
   o travamento de 10+ min da 1a versão). Agora `renderKitPreviewData`
   desmarca (`render = false`) todo outro item marcado durante o render e
   remarca logo depois.
2. **O output module do AE não grava em caminho com acento**: "Can not
   create a file in directory C:\Users" (corta no "Usuário" /
   "Mótion Film Packs"). Ler/importar caminho acentuado funciona; só a
   ESCRITA do AE falha. A preview (e o PNG de camada de PSD) é renderizada
   numa pasta temporária só-ASCII (`kitAsciiTempDir`: temp do Windows,
   8.3 curto, ou `C:\Users\Public\MotionFilmTemp`) e o Node move pro pack.

`renderKitPreviewData` agora devolve `timing {build, render, cleanup,
parked}` (diagnóstico). Medido depois das correções: preview de 6 camadas
~19s nesse projeto (montar 4,5s + render 13s -- overhead do próprio AE
nesse projeto pesado; num projeto leve foi 4s).

**Teste ponta a ponta pela UI (botões reais, ponte 8092)**: Save Comp e
Save Layers com 4 camadas selecionadas (+ Null pai e matte como
dependência, camada não selecionada fora) -> mídia copiada -> preview
480x270 -> originais apagados do projeto E do disco -> aplicados numa comp
nova: comp pack virou UMA comp no tempo 2s, layers pack entrou solto no
tempo 4s, parent/matte/offset preservados, mídia vinda de `<pasta do
.aep>/Pack Assets/<pack>/` -> Delete (segurar 3s) apagou as 3 pastas de
pack com as mídias. Tudo de teste removido depois.
### Atualizar sem perder nada: cores e presets em Documentos (v0.9.7)

Pedido do usuário: atualizar a extensão em qualquer computador mantendo
Packs, cores e presets, sem exportar -- e isso vira o padrão daqui pra
frente. Os Packs já estavam em `Documents/Mótion Film Packs`. O resto
(tema, paletas da janela de cores, presets de legenda e de estilo, seções
recolhidas, larguras) estava só no localStorage do CEP, que mora em
`%TEMP%\cep_cache\AEFT_<versão do AE>_<id>`: não some quando a extensão é
reinstalada, mas some quando o AE atualiza (o PC do usuário tem as duas,
26.3 e 26.5) ou numa limpeza de disco.

- `shared-core.js` -> `initUserDataStore`: espelha toda chave
  `motionfilm-*`/`mfl-*` em `Documents/Mótion Film Packs/settings.json`.
  Ao carregar, o arquivo é despejado no localStorage (arquivo vence); na
  1a vez de cada janela, o localStorage dela é migrado pro arquivo (o
  painel principal é dono das chaves compartilhadas, tipo o tema). Cada
  gravação relê o arquivo e mescla uma chave (4 janelas usam o mesmo
  arquivo); arquivo corrompido vira `settings.broken-<ts>.json`.
- Tamanho do Null: fica nas prefs do AE (`app.settings`, que não passa
  pra versão nova do AE) -- agora também em `motionfilm-null-size` e
  re-semeado no AE quando as prefs não têm.
- Instalador: mostra "Instalada: X -> nova: Y", extrai pra `<pasta>.new`
  e só então troca, e avisa que Packs/cores/presets foram mantidos.
- `installer\package.ps1` gera exe + `motion-film-v<v>-completo.rar`
  (com `INSTALAR.txt` de `installer\INSTALAR.txt`).

Testado: migração real nas janelas abertas (principal + Camadas), gravar
e apagar chave de duas janelas sem uma perder a da outra, e num harness
Node: localStorage vazio (AE atualizado) volta tudo do arquivo; arquivo
corrompido é guardado e recomeça.

### v0.9.8 -- Pack aplica em ~1 s (era ~10 s) + 3 bugs de fidelidade

Medido ao vivo no pack "packs de texto" (9 camadas, 481 KB de data.json):
**9,2 s -> 1,3 s** pra aplicar.

- **O `JSON` do ExtendScript é um polyfill em script, não nativo**:
  `JSON.parse` levou 6-9 s nos 481 KB (`String(JSON.parse)` não tem
  `[native code]`). `eval` levaria 0,2 s, mas executaria o texto de um
  pack que pode vir do zip de outra pessoa -- descartado; validar com as
  regex do json2 custou 6,5 s. Solução: `kitParseJson` (host.jsx), leitor
  só-dados: UMA regex global acha cada token (o motor de regex é nativo) e
  uma pilha explícita monta os valores. 0,7 s nos 481 KB, resultado
  idêntico ao JSON.parse, sem eval. `kitReadJson` usa ele (JSON.parse de
  reserva). `JSON.stringify` do polyfill é aceitável (0,2 s).
- **Cada camada era gravada 2x**: `captureSingleLayerTemplate` põe um
  `preset` (cópia de effects/textAnimators/transform pra leitores antigos
  de style preset). Packs nunca leem quando os campos de cima existem.
  `kitSlimLayers` (panel.js) tira ao salvar, e ao aplicar/gerar preview
  de packs antigos: 481 -> 290 KB.
- **setValue só quando muda** (`styleValueAlreadySet`): a captura grava
  TODA folha, padrões incluídos (103 slots por animador de texto); ler
  `.value` é barato, `setValue` não. Montagem 2,5 s -> 1,2 s, resultado
  idêntico (recapturado e comparado propriedade por propriedade).
- Índice de footage por aplicação (`kitFootageIndexGet`) em vez de varrer
  o projeto inteiro pra cada mídia.

Bugs achados recapturando o pack aplicado e comparando com o salvo
(existiam antes; confirmados renderizando original vs aplicado):
1. **Parentesco com `.parent =`** mantém a posição no MUNDO e reescreve
   os valores do filho -- filho de Null movido/escalado/girado caía em
   outro lugar (texto em -2093,-390 em vez de 100,50). Agora
   `setParentWithJump` (mantém os valores capturados, que já são locais).
2. **Animador de texto perdia valores estáticos** (Position y +100,
   Opacity 0, Blur 15 com só o Range Selector animado = a entrada de
   texto clássica): o texto aparecia inteiro. `nodeNeedsForcedAdd` agora
   também ativa o canal quando o valor capturado DIFERE do padrão do slot
   inerte (igual = slot inerte, ex. o Fill Color vermelho do TextEvo, que
   continua sem ativar). Vale também pros Style Presets das legendas.
3. **Keyframe Linear virava Bezier**: `setTemporalEaseAtKey` converte a
   key; agora ease primeiro, tipo de interpolação por último.
Extra: valor estático que o AE recusa (plugin que só libera um parâmetro
depois de outro) ganha uma 2a tentativa no fim do grupo. O "18 vs 2" do
Deep Glow 2 que sobrou na comparação é um parâmetro de camada apontando
pra própria camada (índice muda na comp nova) -- equivalente.

### v0.9.8 -- crash "Undo group mismatch" ao mover um Pack aplicado

Relatado pelo usuário: aplicar um Pack e arrastar a camada na timeline
dava "Undo group mismatch, will attempt to fix" e o AE caía ("Crash in
progress ... Set Artisan Task: Classic 3D"). Reproduzido: aplicar +
Edit > Undo dava o mesmo aviso. Isolado com experimentos (cada um uma
operação dentro de um undo group + Undo): **`app.beginUndoGroup` aninhado
dentro de outro dá o mismatch no AE 26.5** -- o comentário antigo dizia
que aninhar era permitido. Pack de comp = grupo do applyKitPackFile +
grupo do applyKitLayerGroupList; preview de pack com precomp idem.
Correção: `kitUndoBegin/kitUndoEnd` (contador; só o grupo de fora chega
ao AE) em todo o código do Kit, e `kitUndoCloseAll` no começo/fim das
entradas (um erro no meio nunca deixa grupo aberto). Testado pelo
usuário: aplicar + mover, sem crash.

### Instalador = "Mótion Film" (instala/atualiza tudo) + GitHub

- `Motion-Film-Setup-<v>.exe`: instala OU atualiza a extensão CEP (todas
  as janelas) + plugin do Figma; detecta versão instalada à mão; remove
  cópia manual antiga em Program Files (UAC quando precisa).
- RAR só com o .exe + INSTALAR.txt (sem pastas pra copiar).
- Repositório público `CDMMotion/motion-film`; cada versão vira uma
  Release com o .exe (`installer\release.ps1`).

## Changelog -- v0.9.9: verde padrão, sólido preto, âncora na comp, instalador

- Cor padrão (accent) dos painéis e do plugin do Figma: `#00f011` (era o
  roxo `#9f7aea`). Uma cor escolhida pelo usuário continua valendo; o
  Reset volta pro verde. `MF.color.applyAccent` (shared-core.js) seta
  `--accent`, `--accent-bright`, `--accent-rgb` e `--accent-ink`; os
  ~15 tons translúcidos que eram `rgba(159,122,234,x)` fixo (ficavam
  roxos mesmo com outra cor escolhida) agora são `rgba(var(--accent-rgb),x)`.
  Texto sobre fundo accent usa `--accent-ink` (escuro em cor clara).
- Sólido (painel principal e MF - Camadas): sempre preto (antes pegava a
  cor accent).
- Ponto âncora: Shift+clique num dos 9 pontos leva a âncora até aquele
  ponto do QUADRO DA COMP (não da camada), e a camada fica onde está --
  ex.: texto na borda com âncora no centro da tela. A conversão comp ->
  espaço da camada usa `fromComp()` do próprio AE num Point Control
  temporário (removido em seguida, dentro do mesmo undo), então parent,
  escala, rotação e posição animada saem exatos (testado: canto do texto
  não mexe em t=0/1/2 s com parent girado/escalado).
- Instalador com o visual do painel: fundo #212121, cartão arredondado
  com "01 / INSTALAR" em verde, selo de versão, caixa tracejada de status,
  botões arredondados (principal verde com texto escuro), barra de título
  escura; ícone verde. Layout conferido com um build `/define:PREVIEW`
  (só mostra a tela, nunca instala).

### v0.9.9 -- Packs 1:1: cada camada leva um preset do próprio AE (.ffx)

Relatado pelo usuário: Colorama salvo num Pack voltava com o Output Cycle
padrão. Esse parâmetro (assim como Curves e dados de vários plugins) é
CUSTOM_VALUE: script não lê nem escreve, então o JSON nunca carregaria.
O AE 26.5 tem `layer.savePreset(File)` (sem janela; grava as
propriedades SELECIONADAS da camada -- o mesmo .ffx do "Save Animation
Preset"). Agora, ao salvar, cada camada (inclusive dentro de precomps)
ganha `ffx/L<n>.ffx` com Transform, Effects, Masks, Layer Styles, Text,
Contents, Camera/Light/Material/Geometry, Audio e Time Remap. Ao aplicar,
o JSON recria a camada (tipo, mídia, tempo, switches, parent, matte) e o
`applyPreset` preenche tudo. `applyPreset` põe o PRIMEIRO keyframe do
preset no tempo atual da comp -- então o playhead vai até onde esse key
pertence (`ffxFirstKey` + deslocamento) e volta depois; se cair fora da
comp, os keys são deslocados depois. A seleção do usuário é guardada e
restaurada na captura. Packs antigos (sem ffx/) seguem pelo JSON.
Export/Import levam a pasta ffx/.
Testado no AE com o preset "Película holográfica" (Colorama com Output
Cycle próprio + 8 efeitos) e um texto animado com expressão: frames do
pack novo idênticos byte a byte ao original (Save Layers e Save Comp);
o caminho antigo (JSON) diferia em 38-65% dos pixels. Salvar 0,26 s,
aplicar 0,35 s.

## Changelog -- Mótion Figma Layers: frames na posição do Figma + cantos como Mask

Feedback do usuário:
1. Importando frames de dentro de um "quadro" um por vez, cada comp
   entrava centralizada na comp ativa -- todas uma em cima da outra.
   Agora o plugin manda `place` (transform e caixa do frame no espaço do
   frame de topo, ou da página se ele mesmo é de topo) e o AE põe a camada
   da comp no lugar: comp ativa do tamanho do frame de topo = posição
   exata do Figma; outro tamanho = o frame de topo fica centralizado e
   cada frame cai onde estaria dentro dele (um por vez ou todos juntos dá
   o mesmo resultado); frames soltos na página = o conjunto centralizado
   mantendo a posição relativa.
2. Cantos arredondados de um frame que recorta (clip content) se perdiam
   no frame importado (os aninhados já tinham). Agora a camada da comp
   ganha a Mask "Cantos" com o raio de cada canto do Figma.
Sem comp aberta, a comp só é criada (não há camada para posicionar nem
para receber a mask). Payload de plugin antigo (sem `place`) continua
centralizado. Testado com Figma simulado + AE: sub-frames em (20,160) e
(230,110) exatos numa comp 400x320, masks de raio 12/30/24, e alinhados
ao quadro centralizado numa comp 1920x1080.

### Mótion Figma Layers: vetores "invisíveis" (máscara do Figma exportada vazia)

Relatado: ícones importados mostravam o traçado no AE mas não renderizavam.
Inspecionado no projeto do usuário (comp "Web"): as camadas tinham track
matte numa camada "◩ LAzYA70F3Ea" -- a máscara do Figma -- que chegou como
PNG de 1x1 px. O Figma exporta VAZIO um nó com isMask. Agora (code.js):
- `exportPng` exporta uma cópia temporária sem isMask, solta na página com
  a mesma transform absoluta (fora de auto layout), e apaga a cópia;
- `maskDesc`: máscara VECTOR = só o contorno (preenchimento opaco);
  ALPHA/LUMINANCE com cor sólida = shape; imagem/gradiente/grupo = PNG;
  PNG que ainda vier vazio cai pro contorno (`solidMatte`) com aviso.
- A janela grava o último payload em Documentos/Mótion Figma Layers/
  ultima-importacao.json (sem os PNGs) para diagnosticar importações.
Testado com Figma simulado (nó-máscara exporta 1x1 como o real): matte
29x29 correta, e o caminho do contorno; render no AE mostra o ícone (o
import antigo do usuário renderiza vazio).

## Changelog -- Folders: pastas de camadas na timeline (aba Effects, "02 / FOLDERS")

Pedido do usuário: nossa versão do "Accordion" (Motion Fun). Camadas
relacionadas ficam juntas embaixo de um Null cabeçalho ("▾ Nome" /
"▸ Nome (n)") e a pasta some da timeline ao fechar, sem precompor.
Fechar usa o switch Shy (e liga Hide Shy Layers); as camadas continuam
renderizando. Os dados ficam no comentário do Null (`mf-folder:` + JSON),
então vão junto com o .aep.
- Barra: Group (Shift = já fechada, Alt = camadas seguem o Null), Fold e
  Unfold (pastas da seleção; nada selecionado ou Alt = todas), modo
  Accordion (abrir uma pasta fecha as irmãs).
- Lista: subpastas indentadas (mãe fechada esmaece as filhas), clique
  abre/fecha, Shift = só esta, Alt = com subpastas, duplo clique renomeia,
  contador seleciona (Shift soma), ícones solo/olho/cadeado com memória dos
  switches de cada camada, aviso "moved" com Regather / Update.
- Botão direito: cores (com ou sem as camadas), Rename, Select, Solo/Hide/
  Lock, Up/Down, Duplicate (subpastas, parent e matte apontando pras
  cópias), Parent to folder, Folder matte (AE 2023+), Folder FX
  (adjustment layer), Ungroup, Dissolve e Strip all (segurar 0,7 s ou
  Alt+clique).
- Shy que o usuário já tinha é respeitado: cada pasta guarda o shy
  "do usuário" de cada membro e só esconde por cima dele.
- host/folders.jsx (carregado sob demanda) + client/folders.js. Cada
  ação = 1 undo. A lista atualiza ao mostrar a aba, ao focar o painel e
  ao entrar com o mouse (sem polling).
Testado no AE: todas as ações em comps de teste (inclusive shy prévio,
subpasta fechada dentro de mãe aberta, camada travada, moved/regather,
duplicate com subpasta) e o fluxo pela interface real (Group -> clique
fecha -> Logo/Texto shy + Hide Shy Layers).

### Folders: renomear com duplo clique, nome ao criar, aba "Tools"

- Bug: o 1o clique do duplo clique abria/fechava a pasta e redesenhava a
  linha -- a caixa de nome piscava e sumia. Agora o clique simples espera
  230 ms (cancelado pelo duplo clique) e a lista não redesenha enquanto um
  nome está sendo editado.
- Group abre a janelinha de nome (a mesma do Save dos Packs, exposta como
  `window.MF.openNamePopover`), já com "Group" selecionado; Shift/Alt do
  clique continuam valendo.
- A aba Effects virou "Tools" (ícone de ferramenta) e passou a ser a 2a,
  ao lado da Home. Ids internos (page-effects) mantidos.
Testado no AE pela interface: ordem das abas, nome pela janelinha, duplo
clique abre a caixa (continua aberta e focada após 1 s) e renomeia sem
fechar a pasta.

