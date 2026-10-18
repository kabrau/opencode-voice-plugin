import { Plugin } from "@opencode/plugin"

/**
 * Entrypoint de servidor exigido pelo layout de descoberta de plugins
 * (`index.ts` + `tui` no mesmo diretório). Toda a funcionalidade vive no `tui.tsx`;
 * este plugin é intencionalmente vazio.
 */
export default Plugin.define({
  id: "voice.server",
  setup() {},
})
