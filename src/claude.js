// Collegamento a Claude per la versione installabile di Spesa Furba.
// Espone window.claude.use(name) con la stessa forma usata dalla versione su claude.ai:
// "sample" chiama l'API Anthropic con la chiave salvata sul telefono, gli altri nomi danno null.
import Anthropic from "@anthropic-ai/sdk";

const KEY_STORE = "spesafurba.apikey";
const MODEL_STORE = "spesafurba.model";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (il più preciso)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (più economico)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (il più economico)" },
];

function read(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
function write(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) {} }

export const settings = {
  get apiKey() { return read(KEY_STORE); },
  set apiKey(v) { write(KEY_STORE, (v || "").trim()); },
  get model() { return read(MODEL_STORE) || MODELS[0].id; },
  set model(v) { write(MODEL_STORE, v); },
};

function fail(code, message, extra) { const e = new Error(message); e.code = code; Object.assign(e, extra || {}); return e; }

function client() {
  const apiKey = settings.apiKey;
  if (!apiKey) throw fail("no_key", "Manca la chiave API");
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function imageBlocks(images) {
  if (!images) return [];
  const list = images instanceof Blob ? [images] : Array.from(images);
  const out = [];
  for (const img of list) {
    const media_type = /^image\/(jpeg|png|gif|webp)$/.test(img.type) ? img.type : "image/jpeg";
    out.push({ type: "image", source: { type: "base64", media_type, data: await blobToBase64(img) } });
  }
  return out;
}

const EFFORT = { quick: "low", default: "medium", complex: "high" };

function supportsFallbacks(model) { return model === "claude-opus-5-5" || model === "claude-sonnet-5-5"; }
function supportsWeb(model) { return model !== "claude-haiku-4-5"; }

function mapError(err) {
  if (err && err.code) return err;
  const status = err && err.status;
  if (status === 401 || status === 403) return fail("bad_key", "Chiave API non valida");
  if (status === 429) return fail("rate_limited", "Troppe richieste");
  if (status === 400) return fail("invalid_request", (err && err.message) || "Richiesta non valida");
  if (err && err.name === "AbortError") return fail("cancelled", "Interrotto");
  if (err instanceof Anthropic.APIConnectionError) return fail("offline", "Nessuna connessione");
  return fail("upstream_error", (err && err.message) || "Errore");
}

// Una chiamata completa. Con opts.web Claude può cercare e leggere pagine web (lato server Anthropic).
async function run(input, opts = {}) {
  const c = client();
  const model = settings.model;
  const text = typeof input === "string" ? input : input.map(m => m.content).join("\n\n");
  const content = [...(await imageBlocks(opts.images)), ...(opts.pdf ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: await blobToBase64(opts.pdf) } }] : []), { type: "text", text }];
  const messages = [{ role: "user", content }];
  const tools = opts.web && supportsWeb(model) ? [
    { type: "web_search_20260209", name: "web_search", max_uses: 6, user_location: { type: "approximate", country: "IT", ...(opts.city ? { city: opts.city } : {}) } },
    { type: "web_fetch_20260209", name: "web_fetch", max_uses: 8, max_content_tokens: 40000 },
  ] : undefined;
  const params = {
    model,
    max_tokens: opts.web ? 32000 : 16000,
    messages,
    ...(tools ? { tools } : {}),
    ...(model.startsWith("claude-haiku") ? {} : { output_config: { effort: EFFORT[opts.modelTier || "default"] || "medium" } }),
    ...(supportsFallbacks(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
  };
  try {
    let response;
    for (let round = 0; round < 6; round++) {
      const stream = c.beta.messages.stream(params, { signal: opts.signal });
      response = await stream.finalMessage();
      if (response.stop_reason !== "pause_turn") break;
      // il server ha messo in pausa una ricerca lunga: si riprende mandando indietro il turno
      messages.push({ role: "assistant", content: response.content });
    }
    if (response.stop_reason === "refusal") throw fail("refused", "Richiesta rifiutata");
    const out = response.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (!out) throw fail("empty_completion", "Risposta vuota");
    return { text: out, truncated: response.stop_reason === "max_tokens", modelTierApplied: opts.modelTier || "default" };
  } catch (err) { throw mapError(err); }
}

function parseJson(text) {
  const t = text.replace(/```(?:json)?/g, "");
  const start = t.search(/[{[]/);
  if (start < 0) throw fail("invalid_json", "Risposta non in JSON");
  const open = t[start], close = open === "{" ? "}" : "]";
  for (let end = t.lastIndexOf(close); end > start; end = t.lastIndexOf(close, end - 1)) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) {}
  }
  throw fail("invalid_json", "Risposta non in JSON");
}

function sample(input, opts) { return run(input, opts); }
sample.json = async (input, opts) => parseJson((await run(input, opts)).text);
sample.limits = async () => ({ maxPromptBytes: 2_000_000, images: { maxCount: 6, maxInputBytes: 5_000_000, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] }, pdf: true, web: supportsWeb(settings.model) });
sample.test = async () => { await run("Rispondi solo: ok", { modelTier: "quick" }); return true; };

window.claudeSettings = settings;
window.claudeModels = MODELS;
window.claude = { use: async name => (name === "sample" ? sample : null) };
