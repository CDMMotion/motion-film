# Mótion Film

Extensão CEP para After Effects (janelas Mótion Film, MF - Paleta de Cores,
MF - Camadas e Mótion Figma Layers) + plugin do Figma "Mótion Figma Layers".
Funciona no Windows e no Mac.

## Instalar / atualizar

Baixe da Release mais recente (aba **Releases** deste repositório) e feche
o After Effects antes:

- **Windows:** `Motion-Film-Setup-<versão>.exe` — rode e clique em
  Instalar/Atualizar. Instruções: [installer/INSTALAR.txt](installer/INSTALAR.txt).
- **Mac:** `Motion-Film-Mac-<versão>.zip` — abra o
  `Instalar-Motion-Film-<versão>.pkg`. Instruções (inclusive como liberar o
  aviso de "desenvolvedor não verificado"):
  [installer/mac/INSTALAR-MAC.txt](installer/mac/INSTALAR-MAC.txt). Pelo
  Terminal, sem esse aviso:

  ```bash
  curl -fsSL https://raw.githubusercontent.com/CDMMotion/motion-film/main/installer/mac/get.sh | bash
  ```

O mesmo arquivo instala ou atualiza. Packs, cores e presets ficam em
`Documentos/Mótion Film Packs` e nunca são apagados por uma atualização.

## Estrutura

- `motion-film/` — a extensão CEP (`CSXS/manifest.xml`, `client/`, `host/`).
  Changelog detalhado em [motion-film/README.md](motion-film/README.md).
- `figma-plugin/` — plugin do Figma (bridge em `127.0.0.1:47811`).
- `installer/` — instalador Windows (C#, compilado com o csc do .NET 4.x).
- `installer/mac/` — instalador Mac (.pkg), montado e testado num Mac do
  GitHub Actions (`.github/workflows/mac.yml`); inclui o `whisper-cli`
  (legendas) compilado para Mac.
- `HANDOFF.md` — notas de desenvolvimento e armadilhas conhecidas.

## Lançar uma versão

1. Suba a versão em `motion-film/CSXS/manifest.xml` (5 ocorrências) e o
   `?v=` dos `<script>`/`<link>` alterados.
2. `powershell -ExecutionPolicy Bypass -File installer\release.ps1`
   — compila o `.exe`, monta o `.rar`, faz commit/tag `v<versão>`,
   envia e cria a Release no GitHub com os dois arquivos anexados.
3. A Release publicada dispara o workflow **Instalador Mac**: ele compila,
   testa a instalação em Mac Apple Silicon e Intel e anexa o
   `Motion-Film-Mac-<versão>.zip` na mesma Release (~15 min). Se o teste
   falhar, o zip do Mac não é anexado.
