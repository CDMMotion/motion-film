# Análise: AfterFlix Captions (v1.7.8) → nossa versão no Mótion Film

Fonte: `%APPDATA%\Adobe\CEP\extensions\AfterflixCaptions` (instalada, código JS/JSX
**aberto e comentado**, sem ofuscação nem jsxbin). REA (`rea-agents
analyze-javascript-application`) rodado na pasta: 22 arquivos, a única chamada de
rede é `js/auth.js` (login/assinatura no afterflix.com, Wix). Todo o resto é local.

> Regra da nossa versão: reimplementar as **ideias e algoritmos** com código nosso.
> Não copiar arquivos deles: código, `presets/shadow_*.ffx` (vêm do produto
> "Afterflix Animations"), vídeos de prévia, fontes renomeadas `Afx*` (usar as
> originais OFL: Inter, Montserrat, Instrument Serif, Great Vibes, Playfair,
> Libre Caslon; `RL Madena` é comercial, não usar). Nada de auth/assinatura.

## Arquitetura

| Arquivo | Papel |
|---|---|
| `jsx/captions_engine.jsx` (2188 l.) | Motor ES3 no AE: render do áudio, criação das camadas, animações, estilos virais, registro no XMP |
| `js/transcriber.js` | Node (CEP mixed context): job em pasta temp, roda `whisper-cli` |
| `js/core/audio.js` | Decodifica AIFF/WAV em JS puro, mono, resample p/ 16 kHz (sinc+Blackman), envelope RMS e máscara de voz |
| `js/core/align.js` | JSON do whisper → palavras com tempo (DTW) + refino pela máscara + filtro de alucinação |
| `js/core/captions.js` | Agrupamento palavras → blocos (programação dinâmica) e timing final |
| `js/core/transcript.js` | Transcrição editável; edição de texto preserva tempos (LCS) |
| `js/core/viral.js` | Estilos "Reels/Virais": escolha da palavra destaque, presets (fontes, cores, efeitos, layouts) |
| `js/main.js`, `editor.js` | UI: abas Texto / Animação / Destaque / Ajustes, editor de legendas |
| `bin/win-x64/whisper-cli.exe` + `models/ggml-base-q5_1.bin` (60 MB) | Tudo embutido no instalador, sem download |

## Pipeline

1. **Áudio da comp inteira via Render Queue** (`renderAudioJSON`): adiciona a comp
   na fila, aplica o template de saída "AIFF 48kHz", desliga temporariamente os
   outros itens da fila, `rq.render()`, restaura. Pega exatamente o que se ouve
   (comps aninhadas, mute/solo, time remap, stretch). Opção "Só a Work Area".
   → elimina o ffmpeg e a nossa limitação de Time Remap.
2. **Prep no Node**: lê o AIFF em blocos de ~4 s, mono, resample 16 kHz, grava WAV.
   Envelope RMS a cada 10 ms; limiar = `max(-55 dB, piso + max(8, (pico-piso)*0.25))`
   (piso = percentil 10, pico = 99,5), fecha buracos < 80 ms. Se pico < -60 dB ou
   < 0,3 % ativo → "sem som".
3. **whisper-cli**: `-m <modelo> -f audio16k.wav -l <lang|auto> -t <cpus-1, máx 8>
   -ojf -of result -pp -np -dtw base -nfa`. `-dtw` dá `t_dtw` por token (fim do
   token, em 10 ms); `-nfa` (flash attention off) é obrigatório p/ DTW. Prioridade
   BELOW_NORMAL, progresso lido do stderr (`progress = N%`). Caminho com acento:
   roda com `cwd` = pasta do job e caminhos relativos ASCII (copia o modelo p/ cache
   se precisar).
4. **Alinhamento** (`align.js`): palavra começa onde o token anterior terminou e
   termina no `t_dtw` do último token; tokens só de pontuação grudam na palavra.
   Refino: início em silêncio → avança p/ o 1º quadro com som (-20 ms); fim em
   silêncio → recua p/ último quadro com som (+60 ms); mínimo 80 ms.
   Remove segmentos alucinados ("obrigado por assistir", "legendas pela comunidade
   amara.org"...) ou com < 2 % de som.
5. **Agrupamento** (`captions.js`): quebra dura em pausa ≥ `pauseBreak` e fim de
   frase; dentro da frase, DP que minimiza blocos respeitando maxWords/maxChars/
   maxLines/maxDuration, bônus p/ quebrar após vírgula, penalidade p/ terminar em
   palavra fraca ("de", "a", "que"...). Quebra de linha balanceada (pirâmide).
   Timing: `linger` após a fala, duração mínima, buracos < 0,25 s fechados (não pisca).
   Modos: classic (12 palavras/2 linhas), dynamic "3 palavras", word "uma por vez", viral.
6. **Criação no AE** (`createJSON`): payload grande vai por arquivo temp
   (`viaFile`) porque evalScript grande volta string vazia.

## Truques de After Effects que valem copiar (a ideia)

- **Velocidade**: estiliza UMA camada modelo numa comp oculta temporária e usa
  `copyToComp` p/ cada legenda (estilizar texto custa 0,3–0,9 s por camada).
  `copyToComp` não devolve a cópia → marca a origem com um comment e procura.
- **"Park viewer"**: durante a criação abre uma comp 16×16 vazia no viewer e reabre
  a do usuário no fim — AE redesenha a cada mudança, isso deixa 5–10× mais rápido.
- **Palavra por palavra sem keyframes**: um marcador de camada por palavra
  (marcador n = palavra n) + Text Animator com Expression Selector baseado em
  palavras; `textIndex` lê `marker.key(i).time`. Destaque da palavra falada, revelar,
  entrar com blur/slide — e o usuário ajusta o sync arrastando marcadores.
  Curva das entradas: `100 * (1-p)^3 * (1+3p)` (sai parado, assenta suave).
- **Métrica fixa da fonte** medida com "ÁÉÍgjpqyH": todas as legendas na mesma
  altura (acento/descendente não pula o texto). Encolhe a escala se passar de 88 % da largura.
- **Degradê que segue o texto**: efeito Ramp com pontos por expressão
  `toComp([r.left + r.width/2, r.top])` sobre `sourceRectAtTime`.
- **Glow externo** = Drop Shadow com distância 0 (um ou dois empilhados = neon).
  CC Light Sweep parado só com a borda (edge) p/ brilho fino.
- **Fundo (caixa)**: shape layer parentada (`setParentWithJump`) com Rect Size por
  expressão a partir de `parent.sourceRectAtTime`; opacidade = da legenda.
- **Sombra de fundo**: sólido preto com máscara elíptica com feather enorme atrás
  de cada legenda; só faz fade perto de pausas (não pulsa).
- **Registro no projeto**: XMP do `.aep` (namespace próprio) guarda transcrição +
  estilo + snapshot de cada camada (texto, in/out, posição) → reabrir editor,
  regenerar sem transcrever de novo, detectar edições manuais antes de substituir.
  Camadas com comment `AFC|<setId>|<n>` (`|v` peça viral, `|bg` fundo), label vermelho.
- **Fonte faltando**: `app.fonts.getFontsByPostScriptName(ps)[i].isSubstitute`
  (AE 24+) detecta substituição; cai p/ fonte da mesma família.

## Estilo "Viral/Reels"

Cada legenda = um **Null** pai + várias camadas de texto (uma por trecho/papel):
palavras pequenas em cima (`pre`), **palavra destaque** grande no meio (`accent`),
pequenas embaixo (`post`). Destaque escolhido por pontuação: palavra de conteúdo
(fora da stop-list PT/EN/ES), +2/letra até 11, número +30, `!`/`?` +8, última da
frase +6, verbo no infinitivo -4, ≤3 letras -6; pode virar par ("30 mil",
"viral videos"). Legendas longas são divididas no melhor ponto (fim de frase,
vírgula, antes de "e/mas/que", nunca após artigo). Presets definem por papel:
fonte, tamanho (px p/ 1080 de largura), fill, gradient, glow, outerGlow, sweep,
stroke, tracking, layout (alinhamento/inset), paleta de cores que alterna,
animação por papel. Estilos: Halo, Ponto final, Por baixo, Serifa, Keynote,
Sublinhado (traço desenhado com Trim Paths), Lateral, Número, Jogada certa,
Roxo script, Clean, Azul Serif, Fogo.

Animações: Suave (sobe 70 px em 15 quadros, ease 30/100 + blur que some com o
movimento), Zoom suave, Sem animação (palavra aparece no marcador), Blur leve,
Scale Bounce (expressão de overshoot), Slide Palavra, Slide Frase, Scale (rampa
"skate"), e s1–s8 (presets .ffx deles — **substituir por animações nossas**,
ex.: as do Kit/Effects do Mótion Film).

## Comparação com a nossa aba Captions atual

| | Mótion Film hoje | AfterFlix |
|---|---|---|
| Áudio | arquivo-fonte da camada selecionada via ffmpeg | render da comp inteira (Render Queue AIFF), sem ffmpeg |
| Modelo | small 465 MB, baixado no 1º uso | base q5_1 60 MB embutido |
| Tempo por palavra | tokens `-ojf` | DTW (`-dtw base -nfa`) + refino por energia |
| Alucinações | — | filtro por lista + silêncio |
| Agrupamento | por linha/limite de caracteres | DP com palavras fracas, pausas, vírgulas |
| Animação | estilo capturado de uma camada | animators por marcador, palavra a palavra, destaque |
| Viral (destaque) | — | sim |
| Editar depois | — | editor + registro XMP + regenerar |

## Ordem sugerida de implementação

1. Fundação: áudio via Render Queue + whisper com DTW + `align` (refino e
   alucinação) + agrupamento DP. Tira o ffmpeg do fluxo de captions.
2. Camadas rápidas (modelo em comp oculta + copyToComp + park viewer) e
   marcadores por palavra com animators de expressão (destaque/revelar/entradas).
3. Registro no XMP + editor de texto que preserva tempos (LCS) + regenerar.
4. Estilo viral (null + peças, palavra destaque, presets nossos).
