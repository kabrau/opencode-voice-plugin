# Design: plugin de voz para OpenCode V2

> Documento de design — não é a documentação de uso (essa é o [README](README.md)).
> Registra a API **verificada** contra os tipos reais, as decisões tomadas e as investigações
> que fundamentaram o código, incluindo o que **não** é possível fazer na V2 hoje
> (inserir texto no prompt) e por quê.
>
> As revisões ficam no fim do arquivo.

## Objetivo
Plugin CLI (TUI) do OpenCode V2 que adiciona um **ícone de microfone no rodapé do prompt**.
Clicar no ícone (ou usar o atalho) começa a gravar do microfone; clicar de novo para a gravação,
transcreve o áudio via **OpenRouter** (`/api/v1/audio/transcriptions`) e entrega o texto ao usuário
para revisão e envio como prompt da sessão.

**Escopo fechado: ditado avulso.** Uma gravação = uma mensagem. Não há ditado contínuo/streaming
nem leitura das respostas em voz alta (TTS). "Conversar" acontece pelo ciclo normal do OpenCode
(você dita a mensagem, o agente responde por texto).

Funciona em **Windows, Linux e macOS** a partir do mesmo código. Toda diferença de plataforma fica
isolada em um único módulo (`capture.ts`); nada de `if (platform)` espalhado pelo resto.

## Antes de escrever código
Leia as fontes de verdade e confirme as APIs (não invente nada):
- <https://opencode.ai/v2/docs/build/plugins/cli> — API do plugin CLI (context, slot, keymap, dialog)
- <https://opencode.ai/v2/docs/cli/plugins> — descoberta e configuração em `cli.json`
- <https://opencode.ai/v2/docs/cli/keybinds> — IDs de atalho já ocupados
- <https://openrouter.ai/docs/guides/overview/multimodal/stt> — endpoint de transcrição
- Tipos instalados: `node_modules/@opencode/plugin/dist/tui/context.d.ts` (versão 2.0.29)

### Spike obrigatório antes de fechar o design (15 min)
O protocolo do OpenCode define o evento efêmero **`tui.prompt.append`** (`{ text: string }`), que
insere texto no campo do prompt. Não há método de plugin documentado para emiti-lo, então a hipótese
padrão continua sendo "não dá". **Mas confirme**: se for alcançável a partir do CLI plugin, o fluxo
"jogar o texto no input para eu editar e enviar" substitui o dialog e é UX bem melhor. Se não for,
seguir com o dialog (fluxo abaixo). Registre a conclusão no README.

## Ambiente alvo principal
- Windows 11 + PowerShell, OpenCode **v2.0.29** (TUI + serviço local), API de plugins **V2**.
- `ffmpeg` instalado via Chocolatey. **Atenção:** `C:\ProgramData\chocolatey\bin\ffmpeg.exe` é um
  **shim ShinGen** (~392 KB), não o binário real. O binário real fica em
  `C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe`.
- Node 24 + npm. `bun` não está no PATH (o OpenCode embute Bun; não dependa de rodar `bun` na mão).
  `@opencode/plugin` declara `engines: { bun: ">=1.3.14", node: ">=26.4.0" }` → o `npm install`
  emite `EBADENGINE` no Node 24. É só aviso, mas registre no README.
- Usuário fala **português do Brasil**: `language: "pt"` por padrão.
- Linux/macOS: código deve funcionar, mas só Windows é testado de ponta a ponta nesta máquina.
  No README, marcar Linux como "validado pelos comandos, teste real pendente".

## Restrições de API (fatos verificados na 2.0.29 — use exatamente isto)
1. Plugin CLI V2: `Plugin.define({ id, setup(context) })`, importado de `@opencode/plugin/tui`.
   `setup` pode retornar uma função de cleanup (síncrona ou `Promise<void>`).
2. `context` oferece: `options` (`Readonly<Record<string, any>>`), `location`, `app.version`,
   `app.channel`, `client`, `data`, `theme`, `themeMode`, `markdown`, `keymap`, `storage`, `ui`
   (`slot`, `dialog`, `toast`, `router`, `panel`, `tabs`, `model`, `format`), `attention`, `renderer`.
   `DialogPromptOptions` é `{ title, description?, placeholder?, value? }` — use `value` para
   pré-preencher o dialog com o texto ditado.
3. Slot `prompt.footer` recebe **exatamente** `PromptFooterInput`:
   `{ readonly sessionID?: string; readonly mode: "normal" | "shell"; readonly showDetails: boolean }`.
   Use `context.ui.slot({ append: "prompt.footer", render })`. **Nunca** `replace` — quebraria o
   rodapé nativo. (`slot` retorna uma função de unregister; chame no cleanup.)
4. Render de slot devolve JSX de `@opentui/solid`. `<text>` aceita `onMouseDown`, `onMouseUp`,
   `onMouseOver`, `onMouseOut`, `onMouseScroll` (vêm de `RenderableOptions`) — é assim que o ícone
   fica clicável. Cores sempre via `context.theme` (tokens semânticos, ex.: `context.theme.text.base`),
   nunca valores fixos.
5. **Não há API de plugin para escrever no campo de input do prompt.** O texto só pode ser enviado
   como mensagem da sessão:
   `await context.client.session.prompt({ sessionID, text })`
   (`SessionPromptInput = { sessionID: string; text: string; id?: {...} }`).
   Fluxo padrão: transcrever → `context.ui.dialog.prompt({ title, value: texto })` para revisão/edição
   → se retornar string não vazia, enviar com `session.prompt`. Com `autoSubmit: true`, envia direto.
6. `keymap.layer(() => ({ mode: "global", commands: [...] }))` registra comando com
   `id`, `title`, `group`, `bind`, `palette: true`, `slash: { name, aliases?, arguments? }`,
   `enabled`, `suggested`, `run(input?, event?)`. A factory deve ser pura.
   **`ctrl+r` já é `session.rename`** e **`ctrl+p` é `command.palette.show`** — não use.
   Default do plugin: `ctrl+y` (verificado livre nos keybinds do OpenCode), sobrescrevível por
   `keybind` (ex.: `"<leader>v"`, `"ctrl+shift+v"`).
7. `context.storage.store(key, { initial })` persiste JSON entre reinícios (use para o device
   escolhido); `context.storage.memory(key, { initial })` é efêmero.
8. `context.ui.toast.show({ title?, message, variant?: "info"|"success"|"warning"|"error", duration? })`.

### Detalhe de tipos a documentar
`context.d.ts` importa `ResolvedTheme` de `@opencode/theme/tui`, e `@opencode/theme` é
**peer opcional** (não instalado por padrão). Com `skipLibCheck: true` o typecheck passa, mas
`context.theme` tende a virar `any`. Não dependa dele para segurança de tipos.

## Instalação: **na máquina, não por projeto** (pasta global de plugins)
O OpenCode descobre plugins sob o diretório global de configuração. Nesta máquina o global config é
`C:\Users\<você>\.config\opencode`. Portanto, o plugin mora em:

```
<global-config>/plugins/voice/index.ts     # entrypoint de servidor (no-op)
<global-config>/plugins/voice/tui.tsx      # entrypoint TUI (o plugin de verdade)
<global-config>/plugins/voice/*.ts         # capture, ffmpeg, transcribe, settings
```

- O layout documentado mantém **os dois entrypoints juntos** (`index.ts` + `tui`). O `index.ts` é um
  plugin de servidor vazio: `Plugin.define({ id: "voice.server", setup() {} })` — só para casar com o
  layout. Se o teste mostrar que só o `tui.tsx` basta, remova e registre.
- Plugins descobertos importam `@opencode/plugin/tui` direto; o OpenCode resolve o pacote em runtime
  (não precisa de `node_modules` na pasta global).
- **Instalação = copiar o conteúdo de `src/` do repositório clonado para `<global-config>/plugins/voice/`.**
  Os imports relativos (`./capture.js` etc.) continuam válidos porque todos os arquivos vão juntos.
- Alternativa (documentar no fim do README, não é o caminho principal): entrada em
  `~/.config/opencode/cli.json` apontando para o caminho absoluto do clone.

## Entregável
```
opencode-voice-plugin/
  package.json          # type: module, exports: { "./tui": "./src/tui.tsx" }
  tsconfig.json         # jsx: "preserve", jsxImportSource: "@opentui/solid", strict: true,
                        # skipLibCheck: true  ← OBRIGATÓRIO (ver changelog)
  README.md             # instalação (global + alternativa cli.json), config, atalhos, custo,
                        # troubleshooting por SO, e o resultado do spike do tui.prompt.append
  LICENSE               # MIT
  .gitignore
  src/index.ts          # plugin de servidor no-op (layout de descoberta)
  src/tui.tsx           # Plugin.define, slot do ícone, keymap, dialog, envio
  src/capture.ts        # ÚNICO lugar com lógica por plataforma (bindings ffmpeg)
  src/ffmpeg.ts         # resolver binário real, rodar processo, stop limpo, limpeza
  src/transcribe.ts     # OpenRouter /audio/transcriptions
  src/settings.ts       # options + env var + defaults
```
Sem dependências de runtime: apenas `node:child_process`, `node:fs`, `node:os`, `node:path`,
`node:buffer` (funcionam sob o Bun do OpenCode). `fetch` global para HTTP.

`package.json`:
- `dependencies`: `@opencode/plugin` (a doc usa `latest`; fixe a 2.0.29 para casar com o instalado).
- `peerDependencies`: `@opentui/core` `>=0.5.17`, `@opentui/solid` `>=0.5.17`, `solid-js` `>=1.9.0`
  (é o que a doc manda para plugins que renderizam JSX — assim o consumidor usa o OpenTUI do host).
- `devDependencies`: `@opencode/plugin@2.0.29`, `@opentui/core`, `@opentui/solid`, `solid-js`,
  `typescript`, `@types/node`.
- `scripts.typecheck`: `tsc --noEmit`.

## Configuração (plugin options)
```json
{
  "package": "voice",
  "options": {
    "apiKeyEnv": "OPENROUTER_API_KEY",
    "apiKeyFromAuth": true,
    "authIntegration": "openrouter",
    "model": "openai/whisper-large-v3",
    "language": "pt",
    "device": null,
    "ffmpegPath": null,
    "keybind": "ctrl+y",
    "autoSubmit": false,
    "maxSeconds": 55,
    "keepAudio": false
  }
}
```
Regras:
- Chave da API: env var `apiKeyEnv` tem prioridade; se ela não existir, usar a chave que o
  **próprio OpenCode** já guardou (`auth.json`, integração `authIntegration`) — somente leitura.
  Nunca logar, nunca gravar, nunca colocar em options/README como valor real. Se faltar,
  toast explicando como definir.
- `device: null` → autodetectar (ver heurística abaixo). Formatos aceitos:
  Windows = nome exato DirectShow; Linux = nome de source do Pulse/PipeWire (`default`,
  `@DEFAULT_SOURCE@`, ou nome) ou `hw:C,D` para ALSA; macOS = índice numérico (`"0"`, `"1"`).
- `ffmpegPath: null` → resolver pela ordem descrita abaixo.
- `language: "auto"` → omitir o campo `language` no request.
- `maxSeconds` default **55** (não 120): o provedor estoura em ~60 s por requisição. Se o usuário
  subir acima de ~60, avisar no dialog que a transcrição pode falhar.

## Resolução do binário ffmpeg
Ordem:
1. opção `ffmpegPath`;
2. `ffmpeg` no PATH;
3. caminhos conhecidos por plataforma.

**Resolver o binário real, não o shim.** No Windows o Chocolatey expõe um shim em
`C:\ProgramData\chocolatey\bin\ffmpeg.exe`; se o caminho resolvido parecer um shim (arquivo muito
pequeno, ~poucas centenas de KB) desça para o binário de verdade, preferindo
`C:\ProgramData\chocolatey\lib\ffmpeg\tools\ffmpeg\bin\ffmpeg.exe`.
Cachear o resultado.

Se não achar, toast com instrução de instalação (`choco install ffmpeg` / `sudo apt install ffmpeg` /
`brew install ffmpeg`) e desabilitar o clique até resolver.

## Camada de captura (multiplataforma)
Tudo em `src/capture.ts`, com interface única:

```ts
export interface CaptureBackend {
  /** argumentos de entrada do ffmpeg para o dispositivo (nome ou id) */
  inputArgs(device?: string): string[]
  /** lista de dispositivos legíveis (para log e para o caso de múltiplos microfones) */
  listDevices(ffmpeg: string): Promise<string[]>
  /** dispositivo usado quando o usuário não configura `device` */
  defaultDevice(ffmpeg: string): Promise<string | undefined>
}
```

Seleção por `process.platform`:

| platform | inputArgs | listDevices |
|---|---|---|
| `win32` | `["-f","dshow","-i",`audio=${device}`]` — **sempre** resolva um nome real; `audio=default` não existe no dshow | `ffmpeg -hide_banner -f dshow -list_devices true -i dummy` → parsear **stderr**, linhas `"..." (audio)` e `Alternative name "..."` (ffmpeg sai com código != 0, é esperado) |
| `linux` | se `pactl` existe: `["-f","pulse","-i", device ?? "default"]`; senão `["-f","alsa","-i", device ?? "default"]` | `pactl list short sources` (coluna 2; ignorar `.monitor`) → fallback `arecord -l` montando `hw:CARD,DEV` |
| `darwin` | `["-f","avfoundation","-i",`:${device ?? "0"}`]` | `ffmpeg -hide_banner -f avfoundation -list_devices true -i ""` → bloco de áudio, usar o índice |

### `defaultDevice` — heurística obrigatória (medido nesta máquina)
Esta máquina tem **4 dispositivos de áudio**:
```
"Microphone (C922 Pro Stream Webcam)" (audio)
"CABLE Output (VB-Audio Virtual Cable)" (audio)   ← virtual, silencioso
"System Virtual Line (MSI Sound Tune)" (audio)
"Microphone (MSI Sound Tune)" (audio)
```
Um "primeiro da lista" cego pode cair num cabo virtual silencioso. Portanto:
- **Penalizar/ignorar** candidatos com `CABLE Output`, `Stereo Mix`, `What U Hear`, `.monitor`,
  `Virtual`, `Loopback`.
- **Preferir** nomes contendo `Microphone`/`Microfone`/`Headset`/`Mic`.
- Sem certeza → escolher o primeiro não penalizado e emitir toast informando qual foi escolhido.
- Oferecer comando `voice.device` que lista os dispositivos e **persiste** a escolha via
  `context.storage.store("device", ...)` (o `device` das options tem precedência sobre o storage).

### Gravação (idêntica em todas as plataformas)
```
<ffmpeg> -hide_banner -loglevel error <inputArgs> -ac 1 -ar 16000 -y <tmp>/voice-<ts>.wav
```
- `<tmp>` = `os.tmpdir()`.
- **Parar de forma limpa**: escrever `q\n` no stdin do processo e aguardar o exit, para o ffmpeg
  finalizar o header do WAV. Fallback: **matar a árvore de processos** após ~2 s
  (`taskkill /pid <pid> /T /F` no Windows; grupo de processos com `SIGINT`→`SIGKILL` no POSIX).
  Não usar `-nostdin`. Preferir o binário real justamente para que o `q` chegue ao processo certo.
- WSL2: áudio chega pelo WSLg como source do Pulse (normalmente `RDPSource`); se `pactl info` falhar,
  orientar no README `wsl --shutdown` e checar permissão de microfone no Windows.

Enquanto grava: timer de 1 s para o ícone mostrar o tempo decorrido; cortar sozinho em `maxSeconds`.
Apagar o WAV depois de transcrever (a menos que `keepAudio: true`). No cleanup do `setup`, parar
qualquer gravação em andamento e remover temporários.

## Transcrição (OpenRouter)
```ts
// src/transcribe.ts
POST https://openrouter.ai/api/v1/audio/transcriptions
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json

{
  "model": "openai/whisper-large-v3",
  "input_audio": { "data": "<base64 do wav, sem prefixo data:>", "format": "wav" },
  "language": "pt"            // omitir quando language === "auto"
}
```
Resposta: JSON com `text` (transcript) e `usage` (inclui `usage.cost` em USD). Ler só `text`;
em erro, propagar status + corpo.
- Endpoint é **JSON + base64**, não multipart. Não usar o SDK da OpenAI apontando para cá.
- Limite prático de ~60 s de processamento no provedor: por isso `maxSeconds` default 55.
- Timeout de rede generoso (~90 s) com `AbortSignal`; erro de rede/HTTP → toast + manter estado `idle`.
- Texto vazio/whitespace → toast "não entendi" e não envia nada.

> **Extensibilidade (para "outros modelos depois")**: mesmo que hoje só exista OpenRouter, exponha
> uma interface mínima `TranscriptionProvider { transcribe(wavPath, opts): Promise<string> }` e uma
> implementação `openRouterProvider`. Assim trocar/adicionar provedor é adicionar um arquivo, não
> reescrever `transcribe.ts`. `model`/`baseUrl` já vêm das options.

## UX do ícone
Estados (nunca travar o TUI; tudo assíncrono, com guarda contra clique duplo):
- `idle`: `🎤` em cor neutra (`context.theme.text.base`).
- `recording`: indicador vermelho (`●`) + segundos (`3s`); ocultar o tempo quando `showDetails` for `false`.
- `transcribing`: `⏳`.
- `error`: volta pra `idle` + `context.ui.toast.show({ variant: "error", ... })` com a mensagem real
  (exit code do ffmpeg, status HTTP, corpo do erro do OpenRouter).

Clique alterna start/stop. Ignorar cliques durante `transcribing`.
Sem `sessionID` (tela inicial), toast "Abra uma sessão para ditar".
Registrar também no command palette e como slash `/voice` (mesma ação); `voice.device` no palette.

## Fluxo completo
1. Clique/atalho → resolve device (cache/storage) e sobe o ffmpeg → estado `recording`.
2. Segundo clique (ou `maxSeconds`) → `q\n` no stdin → espera exit.
3. Estado `transcribing` → base64 → POST OpenRouter.
4. `autoSubmit: false`: `ui.dialog.prompt({ title: "Ditado", value: texto })` → se string → `session.prompt`.
   `autoSubmit: true`: envia direto.
   *(Se o spike do `tui.prompt.append` funcionar, substituir este passo por inserir no input.)*
5. Estado `idle`, WAV removido, toast curto de confirmação.

## Critérios de aceite
1. `opencode` inicia sem erro e o ícone aparece em `prompt.footer` dentro de uma sessão.
2. Gravar funciona no SO atual **sem** configurar `device` (autodetecção/heurística) e com `device`
   explícito — obrigatório aqui, já que há múltiplos microfones.
3. Clicar no ícone grava e o ícone indica gravação com o tempo correndo.
4. Segundo clique para a gravação, transcreve e abre o dialog com o texto em português editável.
5. Confirmar no dialog envia a mensagem na sessão atual e o agente responde.
6. `ctrl+y` faz exatamente o mesmo que o clique.
7. Erros (sem API key, sem device, sem ffmpeg, HTTP 4xx/5xx, timeout) viram toast claro, sem crash.
8. Nenhum segredo vai para log; temporários removidos; gravação em andamento encerrada no unload.
9. Mesmo código roda em Windows e Linux, sem `if` de plataforma fora de `src/capture.ts`.
10. `npm run typecheck` passa (com `skipLibCheck: true` no `tsconfig.json`).

## Como testar (Windows, ponta a ponta)
1. `npm install` e `npm run typecheck`. (Espere o aviso `EBADENGINE` do Node 24.)
2. Copiar `src/*` para `C:\Users\<você>\.config\opencode\plugins\voice\`.
3. `setx OPENROUTER_API_KEY "sk-or-..."` ou exportar no PowerShell; reabrir `opencode`.
4. Clicar no ícone, falar uma frase curta em português, confirmar no dialog.
5. Testar falhas: sem `OPENROUTER_API_KEY`, `device` inválido, e desligar a rede durante a transcrição.
6. Se o plugin não carregar, verificar o log do OpenCode (`<data>/opencode/log/opencode.log`)
   (existe nesta máquina; `role=cli`).
7. No README, documentar o teste em Linux (Pulse/PipeWire + `pactl list short sources`) como
   "validado pelos comandos, teste real pendente", sem afirmar que foi testado.

## Fora de escopo (não implementar agora)
- Text-to-speech / ler respostas em voz alta.
- Ditado contínuo / streaming em tempo real.
- Transcrição local (whisper.cpp / faster-whisper).
- Inserir o texto no input do prompt **se** o spike do `tui.prompt.append` falhar.
- Publicação no npm, CI, ou suporte a servidor remoto.

## Ao terminar
- Rodar `npm run typecheck` e colar a saída.
- Listar os arquivos criados e o passo exato de instalação (copiar `src/*` → `plugins/voice/`).
- Registrar no README: como obter a chave no OpenRouter, custo por minuto do modelo configurado
  (consultar a página do modelo, não inventar valor), o passo de reiniciar o `opencode`, e o
  resultado do spike do `tui.prompt.append`.

---

## Changelog da revisão 2

1. **`skipLibCheck: true` no tsconfig (obrigatório).** Sem isso o critério 10 falha:
   `context.d.ts` importa `ResolvedTheme` de `@opencode/theme/tui`, que é peer opcional não instalado
   → `error TS2307: Cannot find module '@opencode/theme/tui'`.
2. **ffmpeg: resolver o binário real, não o shim do Chocolatey.** O shim ShinGen pode não encaminhar
   o `q\n` nem o kill ao processo real, quebrando o "parar de forma limpa". Stop passou a encerrar a
   **árvore de processos**.
3. **`defaultDevice` com heurística + `voice.device`.** Medido: 4 dispositivos nesta máquina, incluindo
   cabo virtual silencioso. "Primeiro da lista" não serve.
4. **`maxSeconds` default 120 → 55,** para casar com o limite de ~60 s do provedor.
5. **Instalação fixada na pasta global** (`<global-config>/plugins/voice/`), com o layout documentado
   `index.ts` + `tui.tsx`; `cli.json` virou alternativa.
6. **`@opentui/*` e `solid-js` movidos para `peerDependencies`** (exigência da doc para plugins JSX;
   importante para compartilhar/publicar e para o typecheck local).
7. **Adicionados `LICENSE` (MIT) e `.gitignore`;** nota do `EBADENGINE` (Node 24 vs engines `>=26.4.0`).
8. **Bônus:** spike do `tui.prompt.append` e interface de `TranscriptionProvider` (para "outros
   modelos depois"). Escopo confirmado como **ditado avulso** (sem contínuo/TTS).

## Changelog da revisão 3 (após teste real na TUI)

1. **Ícones passaram a ser glifos do BMP de largura 1** (`○` / `●` / `…`), configuráveis por `icons`.
   Emojis fora do BMP (como `🎤`) aparecem como `?` em alguns terminais e, pior, têm largura ambígua:
   como o clique é roteado por *hit-test* de coordenadas no OpenTUI, o desenho e a área clicável
   desalinham e o clique não funciona. Verificado na TUI: com glifos BMP o clique funciona
   (Windows Terminal / PowerShell).
2. **Atalho padrão alterado de `<leader>v` para `ctrl+y`** — verificado livre nos keybinds do
   OpenCode (`ctrl+h` vira Backspace; `ctrl+s`/`ctrl+q` são XON/XOFF). Continua sobrescrevível.
3. **Chave da API pode vir do store do próprio OpenCode** (`auth.json`) quando a env var não existe,
   com `apiKeyFromAuth`/`authIntegration`. Motivo: o usuário já tem o OpenRouter conectado, e a regra
   "somente env var" obrigava a duplicar o segredo sem necessidade. A leitura é somente-leitura,
   sem log; `apiKeyFromAuth: false` restaura a postura "só env var".
4. **Ditar na tela inicial agora funciona** (`allowFromHome`, default `true`): sem `sessionID`,
   o plugin cria a sessão via `client.session.create`, navega até ela e envia o texto. Antes só
   mostrava "Abra uma sessão para ditar".
5. **A sessão é criada no início da gravação**, não na entrega: assim o usuário já está dentro dela
   quando fala, e uma falha de navegação não descarta o texto (sessão órfã apontada pelo revisor).

## Investigação: inserir texto no prompt (não é possível na V2)

Pedido do usuário: em vez do dialog, jogar a transcrição no campo do prompt para editar ali.
Conclusão: **não há como, hoje**, e a evidência é tripla:
- `UI` do plugin não expõe prompt/composer (conferido em 2.0.29 e 2.0.32).
- OpenAPI do servidor: nenhuma rota `/tui/*`; só `/api/session/{sessionID}/prompt`.
- O evento `tui.prompt.append` é consumido pela TUI (`i.insertText(...)`), mas nada o publica.
  `EventDomain` do plugin só tem `subscribe`; eventos de plugin saem como `rpc.*`, não `tui.*`.
Upstream: [#51209](https://github.com/anomalyco/opencode/issues/51209) (pedido idêntico, citando
ditado por voz), [#54681](https://github.com/anomalyco/opencode/issues/54681) (v2 removeu
`/tui/append-prompt`). Prior art: o plugin V1 `renjfk/opencode-voice` usava `tui.appendPrompt`.

## Onde ficam as options (verificado)

Testei com sondas nos dois entrypoints:
- **`cli.json` → funciona.** `context.options` recebeu `{"autoSubmit":true,...}` e
  `settings.autoSubmit` resolveu `true`. Também confirmou o **hot reload** do plugin na TUI
  (sem reiniciar o `opencode`).
- **`opencode.jsonc` (`plugins: [{ package, options }]`) → não funciona** para o componente de TUI:
  a sonda retornou `{}`. O array `plugins` do server config não entrega options ao TUI plugin.
- Sem duplicação: declarar no `cli.json` um plugin que também está na pasta global de descoberta
  mantém **uma** entrada (`voice.server`, `server:true, tui:true`).

Portanto: options sempre no `cli.json`. Explicitado no README.
