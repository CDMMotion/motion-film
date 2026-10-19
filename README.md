# Mótion Film

Extensão CEP para After Effects (janelas Mótion Film, MF - Paleta de Cores,
MF - Camadas e Mótion Figma Layers) + plugin do Figma "Mótion Figma Layers".

## Instalar / atualizar

Baixe o `Motion-Film-Setup-<versão>.exe` da Release mais recente
(aba **Releases** deste repositório), feche o After Effects e rode.
O mesmo arquivo instala ou atualiza. Packs, cores e presets ficam em
`Documentos\Mótion Film Packs` e nunca são apagados por uma atualização.
Instruções completas: [installer/INSTALAR.txt](installer/INSTALAR.txt).

## Estrutura

- `motion-film/` — a extensão CEP (`CSXS/manifest.xml`, `client/`, `host/`).
  Changelog detalhado em [motion-film/README.md](motion-film/README.md).
- `figma-plugin/` — plugin do Figma (bridge em `127.0.0.1:47811`).
- `installer/` — instalador Windows (C#, compilado com o csc do .NET 4.x).
- `HANDOFF.md` — notas de desenvolvimento e armadilhas conhecidas.

## Lançar uma versão

1. Suba a versão em `motion-film/CSXS/manifest.xml` (5 ocorrências) e o
   `?v=` dos `<script>` alterados.
2. `powershell -ExecutionPolicy Bypass -File installer\release.ps1`
   — compila o `.exe`, monta o `.rar`, faz commit/tag `v<versão>`,
   envia e cria a Release no GitHub com os dois arquivos anexados.
