# opencode-voice-plugin

Ditado por voz para o **OpenCode V2**: um ícone de microfone (`○`) no rodapé do prompt. Clique nele
(ou use `ctrl+y`), fale, e o texto transcrito vira uma mensagem da sessão.

A transcrição usa o **OpenRouter** (`POST /api/v1/audio/transcriptions`) e a chave é reaproveitada do
próprio OpenCode quando você já tem o OpenRouter conectado — sem variável de ambiente e sem duplicar
segredo. Funciona em **Windows, Linux e macOS** a partir do mesmo código, e é instalado **na máquina**
(não por projeto).

[Repositório](https://github.com/kabrau/opencode-voice-plugin) ·
[Issues](https://github.com/kabrau/opencode-voice-plugin/issues) ·
[Design](DESIGN.md) · MIT

---

## Como funciona

1. `🎤` no rodapé do prompt (aparece dentro de uma sessão).
2. Clique, ou `ctrl+y`, ou digite `/voice` → começa a gravar (`●` + segundos).
3. Clique de novo (ou espere `maxSeconds`) → para, transcreve (`⏳`).
4. Abre o dialog **Ditado** com o texto — edite se quiser e confirme → a mensagem é enviada na sessão.

Na **tela inicial** também funciona: como ali ainda não existe sessão, o `ctrl+y` **cria a sessão na
hora** (antes de gravar) e o texto é enviado nela — o mesmo que digitar e dar Enter. Desligue com
`"allowFromHome": false` se preferir que o microfone só aja dentro de uma sessão.

---

## Requisitos

- OpenCode **V2** (`opencode --version`).
- **ffmpeg** no sistema:
  - Windows: `choco install ffmpeg`
  - Debian/Ubuntu: `sudo apt install ffmpeg pulseaudio-utils`
  - macOS: `brew install ffmpeg`
- Uma chave de API do **OpenRouter** (veja [Custo](#custo) e [Chave da API](#chave-da-api)).

---

## Instalação (via npm — recomendado)

```bash
opencode plugin add opencode-voice-plugin
```

Pronto — sem clonar nem copiar arquivo. Atualizar e remover:

```bash
opencode plugin update opencode-voice-plugin
opencode plugin remove opencode-voice-plugin
```

> Para **configurar options** (ícones, atalho, dispositivo, etc.), veja
> [Onde declarar as options](#onde-declarar-as-options) — é um detalhe que o `plugin add`
> sozinho não cobre.

### Sem npm (direto do GitHub)

```bash
opencode plugin add github:kabrau/opencode-voice-plugin
```

---

## Instalação manual (na máquina)

Se preferir cópia local, o OpenCode descobre plugins no diretório global de configuração:

```
<config-global>/plugins/<nome>/index.ts    # entrypoint de servidor
<config-global>/plugins/<nome>/tui.tsx     # entrypoint da TUI (o plugin)
```

No Windows o config global fica em `C:\Users\<você>\.config\opencode`. No Linux/macOS, em
`~/.config/opencode` (ou `$XDG_CONFIG_HOME/opencode`).

### Windows (PowerShell)

```powershell
git clone https://github.com/kabrau/opencode-voice-plugin.git
$destino = "$env:USERPROFILE\.config\opencode\plugins\voice"
New-Item -ItemType Directory -Force -Path $destino | Out-Null
Copy-Item .\opencode-voice-plugin\src\* $destino
```

### Linux / macOS

```bash
git clone https://github.com/kabrau/opencode-voice-plugin.git
destino="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/voice"
mkdir -p "$destino"
cp opencode-voice-plugin/src/* "$destino/"
```

Depois, **reinicie o `opencode`**.

### Instalação alternativa (apontando para o clone)

Aponte o `cli.json` global para o repositório clonado. Isso mantém o plugin atualizado via `git pull`
e é o jeito de passar options, já que a pasta de descoberta não tem onde declará-las:

```json
{
  "plugins": [
    {
      "package": "file:///caminho/para/opencode-voice-plugin",
      "options": {
        "language": "pt",
        "keybind": "ctrl+y"
      }
    }
  ]
}
```

> O caminho pode ser um caminho absoluto ou uma URL `file://`. **Adicione** ao array `plugins`
> existente em `~/.config/opencode/cli.json`, sem apagar o resto do arquivo.

---

## Chave da API

O plugin resolve a chave nesta ordem:

1. **Variável de ambiente** — `OPENROUTER_API_KEY` (ou o nome em `apiKeyEnv`), se existir.
2. **Store do próprio OpenCode** — se você já conectou o OpenRouter, o plugin usa essa chave
   automaticamente. **Nada a configurar.**

Ou seja: se o OpenRouter já aparece conectado, você **não precisa** criar variável nenhuma.
Confira com:

```bash
opencode auth list      # deve listar "OpenRouter ... stored"
```

Se preferir a env var (ou não tiver o OpenRouter conectado):

```powershell
setx OPENROUTER_API_KEY "sk-or-..."     # Windows; reabra o terminal depois
```

```bash
export OPENROUTER_API_KEY="sk-or-..."   # Linux/macOS (~/.bashrc / ~/.zshrc)
```

Gere uma chave em <https://openrouter.ai/settings/keys>. Nos dois casos a chave **nunca** é
logada, copiada nem gravada pelo plugin — e a leitura do store é somente-leitura, do arquivo
que o próprio OpenCode mantém (`<data>/opencode/auth.json`).

Para uma postura "só env var", use `"apiKeyFromAuth": false` nas options; para ler de outra
integração (ex.: a do Console), ajuste `authIntegration`.

---

## Configuração

### Onde declarar as options

As options são lidas do **`cli.json`** (config global), **não** do `opencode.jsonc`. Isso vale
mesmo que você tenha instalado por cópia em `plugins/voice/`: adicione a entrada abaixo ao array
`plugins` do `~/.config/opencode/cli.json`, preservando o resto do arquivo.

```json
{
  "plugins": [
    {
      "package": "C:\\Users\\<você>\\.config\\opencode\\plugins\\voice",
      "options": {
        "autoSubmit": true
      }
    }
  ]
}
```

> Verificado nas duas direções: com essa entrada, `context.options` recebe o objeto; declarando as
> mesmas options no array `plugins` do **`opencode.jsonc`**, o componente de TUI recebe `{}`.
> Não há duplicação do plugin por estar também descoberto na pasta global.

Todas as options são opcionais.

| Option | Default | Descrição |
|---|---|---|
| `apiKeyEnv` | `"OPENROUTER_API_KEY"` | Nome da variável de ambiente com a chave. Tem prioridade sobre o store. |
| `apiKeyFromAuth` | `true` | Se a env var não existir, usa a chave já guardada pelo OpenCode. |
| `authIntegration` | `"openrouter"` | Integração do OpenCode de onde ler a chave. |
| `model` | `"openai/whisper-large-v3"` | Modelo de STT do OpenRouter. |
| `language` | `"pt"` | ISO-639-1. Use `"auto"` para detecção automática. |
| `baseUrl` | `"https://openrouter.ai/api/v1"` | Base do provedor compatível com `/audio/transcriptions`. |
| `device` | `null` | Microfone. `null` = autodetectar. Formatos por SO abaixo. |
| `ffmpegPath` | `null` | Caminho do ffmpeg. `null` = procurar no PATH e em locais conhecidos. |
| `keybind` | `"ctrl+y"` | Atalho do ditado. Use `"<leader>v"` se preferir (`<leader>` = `ctrl+x`). |
| `autoSubmit` | `false` | `true` envia direto, sem o dialog de revisão. |
| `allowFromHome` | `true` | Permite ditar na tela inicial, criando a sessão na hora. |
| `maxSeconds` | `55` | Corte automático da gravação. Teto de segurança em `120`. |
| `keepAudio` | `false` | `true` mantém o WAV temporário (debug). |
| `icons` | `{ idle: "○", recording: "●", transcribing: "…" }` | Glifos do ícone. Sobrescreva se sua fonte suportar emoji. |

> **Por que os glifos padrão são `○ ● …` e não 🎤:** emojis fora do BMP (como `🎤`) não
> existem na fonte de muitos consoles e aparecem como `?`; além disso a largura deles é
> ambígua, o que **desalinha a área clicável** (o clique roteia por hit-test de coordenadas).
> Os glifos padrão são do BMP, largura 1 e existem em Consolas/Cascadia/DejaVu. Se o seu
> terminal renderiza emoji corretamente, use por exemplo:
>
> ```json
> { "options": { "icons": { "idle": "🎤", "recording": "🔴", "transcribing": "⏳" } } }
> ```

Formatos de `device`:

| SO | Formato | Exemplo |
|---|---|---|
| Windows | nome exato do DirectShow | `"Microphone (C922 Pro Stream Webcam)"` |
| Linux | nome do source Pulse/PipeWire | `"default"`, `"@DEFAULT_SOURCE@"`, `"alsa_input.pci-0000_00_1f.3.analog-stereo"` |
| Linux (ALSA) | `hw:CARD,DEV` | `"hw:1,0"` |
| macOS | índice numérico | `"0"` |

---

## Uso

| Ação | Como |
|---|---|
| Iniciar / parar | clique no ícone, ou `ctrl+y`, ou `/voice` |
| Escolher microfone | command palette → **"Voz: escolher microfone"** (a escolha fica salva) |
| Enviar sem revisar | `"autoSubmit": true` nas options |

Estados do ícone: `○` ocioso · `● Ns` gravando · `…` transcrevendo. Erros sempre viram um toast,
nunca travam a TUI.

---

## Custo

O `openai/whisper-large-v3` é cobrado **por token** (o áudio é tokenizado), e o preço varia por
provedor. Valores consultados na API do OpenRouter em out/2026 (por 1M de tokens de prompt):

| Provedor | Preço (prompt) |
|---|---|
| DeepInfra | US$ 7,50 / 1M tokens |
| Together | US$ 25,00 / 1M tokens |
| Groq | US$ 30,83 / 1M tokens |

O OpenRouter roteia automaticamente para um provedor disponível — o custo real de cada requisição
vem no campo `usage.cost` da resposta. Como ordem de grandeza, o exemplo da própria documentação do
OpenRouter mostra uma transcrição de 9,2 s custando **US$ 0,000508**.

**Confira os valores atuais** na página do modelo: <https://openrouter.ai/openai/whisper-large-v3>
(e o painel de gastos em <https://openrouter.ai/activity>). Não confie nos números acima a longo prazo.

Para trocar de modelo, basta mudar `model` nas options (veja os modelos com
`output_modalities=transcription` em <https://openrouter.ai/models?output_modalities=transcription>).

---

## Troubleshooting

**O plugin não aparece / não carregou**
Verifique o log (existe mesmo no Windows):

```
C:\Users\<você>\.local\share\opencode\log\opencode.log      # Windows
~/.local/share/opencode/log/opencode.log                    # Linux/macOS
```

Procure por `role=cli`. Confirme que os arquivos estão em `<config-global>/plugins/voice/` e
reinicie o `opencode`.

**"ffmpeg não encontrado" (toast)**
Instale o ffmpeg (comandos acima) ou aponte `ffmpegPath` explicitamente. No Windows, o plugin já
desce automaticamente do *shim* do Chocolatey
(`C:\ProgramData\chocolatey\bin\ffmpeg.exe`) para o binário real em
`C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe`, porque o shim pode não repassar
o comando de parada ao processo de gravação.

**"Chave da API ausente" (toast)**
A variável não está visível para o processo. No Windows, `setx` só vale para **novos** terminais —
feche e reabra. Confira com `echo $env:OPENROUTER_API_KEY` (PowerShell) ou `echo $OPENROUTER_API_KEY`.

**Grava silêncio / nada é transcrito**
Provavelmente o dispositivo padrão é um cabo virtual. Rode **"Voz: escolher microfone"** e selecione
o microfone de verdade. A heurística já evita nomes como `CABLE Output`, `Stereo Mix`, `loopback`,
`Virtual` e `.monitor`, mas nem todo dispositivo virtual se denuncia pelo nome.

**Linux: sem microfone / erro do PulseAudio ou ALSA**
Instale `pulseaudio-utils` (fornece o `pactl`, usado para listar os microfones). O plugin usa
`-f pulse` quando encontra o `pactl`, senão cai para `-f alsa` com `default`. Para listar os sources
manualmente:

```bash
pactl list short sources        # ignore linhas terminando em .monitor
arecord -l                      # alternativa via ALSA
```

**WSL2**
O áudio chega pelo WSLg como um source do Pulse (normalmente `RDPSource`). Se `pactl info` falhar,
rode `wsl --shutdown` no Windows, reabra e verifique a permissão de microfone em
*Configurações → Privacidade → Microfone*. Em último caso, use `device` explícito.

**O ícone aparece como `?`** (ou outro caractere estranho)
Sua fonte de console não tem o glifo configurado. O padrão (`○ ● …`) funciona na maioria.
Se você trocou por emoji via `icons`, volte para o padrão ou use uma fonte com emoji.

**Não consigo clicar no ícone**
1. Confirme que o terminal envia eventos de mouse: no **mintty/Git Bash**, veja
   *Options → Mouse* (deve estar habilitado). O OpenTUI liga o mouse tracking ao iniciar.
2. Prefira os glifos padrão (`○ ● …`). Emoji têm largura ambígua e deslocam a área clicável.
3. Clique **em cima** do glifo (há um espaço de folga de cada lado).
4. Enquanto isso, o atalho faz exatamente o mesmo: `ctrl+y` (ou `<leader>v`: `ctrl+x`, depois `v`), ou
   `ctrl+p` → **"Voz: ditar"**, ou `/voice`.

**A transcrição falha ou demora**
O provedor estoura em cerca de **60 s por requisição**. Por isso `maxSeconds` é 55 por padrão. Se você
aumentar, o dialog avisa que gravações acima de 1 minuto podem falhar.

**O começo da fala se perde (Windows)**
O DirectShow leva cerca de 1 s para abrir o dispositivo. Espere o `●` aparecer e só então comece a
falar.

---

## Desenvolvimento

```bash
npm install
npm run typecheck
```

Sem dependências de runtime — apenas módulos nativos do Node (`child_process`, `fs`, `os`, `path`,
`buffer`), que funcionam sob o Bun embutido no OpenCode.

Toda a lógica por plataforma está isolada em `src/capture.ts`. Os demais arquivos não contêm
`if (platform)`.

> Observação: `@opencode/plugin` declara `engines: node >= 26.4.0`. No Node 24 o `npm install` emite
> um aviso `EBADENGINE`, inofensivo para o typecheck.

### Estrutura

```
src/index.ts       entrypoint de servidor (vazio, exigido pelo layout de descoberta)
src/tui.tsx        plugin: slot do ícone, atalhos, máquina de estados, envio
src/capture.ts     ÚNICO módulo com lógica por plataforma
src/ffmpeg.ts      resolução do binário, execução, parada limpa
src/transcribe.ts  OpenRouter /audio/transcriptions
src/settings.ts    options + env + defaults
```

As decisões de design e a pesquisa de API (o que foi verificado e o que **não** é possível)
estão em [DESIGN.md](DESIGN.md).

---

## Limitações conhecidas

- **Ditado avulso:** uma gravação = uma mensagem. Não há ditado contínuo/streaming nem leitura das
  respostas em voz alta (TTS).
- **Sem escrita direta no input do prompt:** a V2 não expõe — a nenhum plugin — um meio de inserir
  texto no campo do prompt. Isso foi verificado em três frentes: (1) a API `UI` não tem nada de
  prompt/composer (nem na 2.0.29 nem na 2.0.32); (2) o OpenAPI do servidor não tem rota `/tui/*`;
  (3) o evento interno `tui.prompt.append` é consumido pela TUI (`insertText` no composer), mas
  **nada o publica** — não há endpoint HTTP nem superfície RPC. A V1 tinha
  `client.tui.appendPrompt`, removido na V2. Por isso o texto passa pelo dialog de revisão
  (já preenchido e editável), e o pedido de reabrir isso está em
  [anomalyco/opencode#51209](https://github.com/anomalyco/opencode/issues/51209)
  (veja também [#54681](https://github.com/anomalyco/opencode/issues/54681)). Quando a API existir,
  trocar o dialog por "inserir no prompt" é uma mudança pequena e localizada.
- **Transcrição na nuvem:** o áudio é enviado ao OpenRouter e ao provedor escolhido. Não use com
  informação sensível se isso for um problema.
- **Linux e macOS** foram validados pelos comandos e pela lógica, mas o teste ponta a ponta foi feito
  apenas no Windows. Teste real em Linux: pendente.

---

## Segurança

- A chave vem da variável de ambiente ou, se ela não existir, do store do próprio OpenCode
  (leitura somente-leitura). Nunca é logada, copiada nem persistida pelo plugin.
- O WAV é gravado em `os.tmpdir()` e apagado depois de transcrever (salvo `keepAudio: true`).
- Uma gravação em andamento é encerrada quando o plugin é descarregado.

---

## Licença

MIT — veja [LICENSE](LICENSE).
