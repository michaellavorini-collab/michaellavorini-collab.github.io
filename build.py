# Costruisce index.html (app installabile) partendo da src/page.html, la stessa pagina della versione su claude.ai.
import re, pathlib
s = pathlib.Path("src/page.html").read_text()
def rep(a, b, cnt=1):
    global s
    assert s.count(a) == cnt, (a[:80], s.count(a))
    s = s.replace(a, b)

head = '''<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#1f7a4a">
<meta name="description" content="Lista della spesa, confronto prezzi, volantini, ricette, carte fedeltà e storico scontrini.">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/icon-192.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.45 system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
'''
s = head + s
rep('<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>',
    '<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>\n<script src="claude.js"></script>')
rep('<style>\n/* Layout:', '</head>\n<body>\n<style>\n/* Layout:')
s = s.rstrip() + '\n</body>\n</html>\n'

# header con impostazioni
rep('''    <span class="sync" id="sync">Avvio…</span>
  </header>''', '''    <span class="row" style="gap:6px;flex-wrap:nowrap"><span class="sync" id="sync">Avvio…</span><button type="button" class="ghost" id="openSettings" aria-label="Impostazioni"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg></button></span>
  </header>
  <div class="note" id="keyBanner" hidden>Per leggere foto, volantini e scontrini serve la tua chiave API di Claude. <button type="button" class="ghost" id="keyBannerBtn" style="padding:0;color:var(--accent);font-weight:700">Inseriscila ora</button></div>''')

# GPS
rep('''      <div class="small muted">La pagina non può leggere il GPS del telefono. Scrivi la tua zona, oppure apri Maps per vedere i supermercati intorno a te.</div>
      <div class="row">
        <a class="btn" id="mapsNear" target="_blank" rel="noopener" href="https://www.google.com/maps/search/supermercati+vicino+a+me">Supermercati vicini su Maps ↗</a>
      </div>''', '''      <div class="row">
        <button type="button" class="primary" id="gpsBtn">Usa la mia posizione</button>
        <a class="btn" id="mapsNear" target="_blank" rel="noopener" href="https://www.google.com/maps/search/supermercati+vicino+a+me">Apri Maps ↗</a>
      </div>
      <div id="gpsMsg" class="small"></div>
      <div id="nearby" style="display:flex;flex-direction:column;gap:6px"></div>''')

# volantini online
rep('''      <div class="small muted">Le offerte dei volantini online arrivano qui da sole ogni mattina per i supermercati che hai scelto. Puoi anche fotografare un volantino di carta: le offerte lette vengono usate come prezzi certi nel confronto.</div>''',
'''      <div class="small muted">Claude cerca da solo i volantini in corso dei tuoi supermercati nella tua zona e ne carica le offerte. Puoi anche caricare un PDF, degli screenshot o la foto di un volantino di carta.</div>''')
rep('''<input type="file" id="flyerFile" accept="image/*,application/pdf,.pdf" multiple class="vh" tabindex="-1">
      </div>''', '''<input type="file" id="flyerFile" accept="image/*,application/pdf,.pdf" multiple class="vh" tabindex="-1">
      </div>
      <div class="row">
        <button type="button" class="primary" id="webFlyer">Cerca offerte online</button>
        <button type="button" id="webFlyerAll">Aggiorna tutti</button>
      </div>''')
rep('''<label class="btn primary" id="flyerBtn" for="flyerFile">Carica volantino</label>''','''<label class="btn" id="flyerBtn" for="flyerFile">Carica volantino</label>''')

# sezione impostazioni
settings_html = '''
  <!-- IMPOSTAZIONI -->
  <section id="tab-impostazioni" class="tab" hidden style="display:flex;flex-direction:column;gap:16px">
    <div class="panel">
      <h2>Claude</h2>
      <div class="small muted">Serve per leggere foto, volantini e scontrini, stimare i prezzi, cercare le offerte online e ordinare il percorso. La chiave resta salvata solo su questo telefono.</div>
      <label class="lbl" for="apiKey">Chiave API</label>
      <div class="row">
        <input id="apiKey" class="grow" type="password" autocomplete="off" placeholder="sk-ant-…">
        <button type="button" id="apiKeyShow" class="ghost">Mostra</button>
      </div>
      <label class="lbl" for="aiModel">Modello</label>
      <select id="aiModel"></select>
      <div class="row">
        <button type="button" class="primary" id="apiSave">Salva e prova</button>
        <a class="btn" href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">Crea una chiave ↗</a>
      </div>
      <div id="apiMsg" class="small"></div>
      <details class="small"><summary>Quanto costa</summary>
        <div style="margin-top:6px;display:flex;flex-direction:column;gap:4px" class="muted">
          <span>Paghi solo quello che usi, sul tuo account Anthropic. Con Claude Opus 5.5, all'incirca: uno scontrino o una carta pochi centesimi; una pagina di volantino 1–3 centesimi; una ricerca dei volantini online 10–30 centesimi per supermercato.</span>
          <span>Con Sonnet 5.5 i costi sono circa la metà. Sulla console Anthropic puoi impostare un limite di spesa mensile.</span>
        </div>
      </details>
    </div>
    <div class="panel">
      <h2>Volantini automatici</h2>
      <label class="row" style="gap:10px;align-items:flex-start"><input type="checkbox" id="autoFlyers" style="width:auto;margin-top:3px"> <span>Quando apri l'app, aggiorna da solo i volantini dei tuoi supermercati se sono scaduti o hanno più di 3 giorni.</span></label>
    </div>
    <div class="panel">
      <h2>I tuoi dati</h2>
      <div class="small muted">Lista, ricette, carte e scontrini sono salvati solo su questo telefono. Fai ogni tanto una copia di sicurezza.</div>
      <div class="row">
        <button type="button" id="backupSave">Salva una copia</button>
        <label class="btn" for="backupFile">Ripristina da file</label>
        <input type="file" id="backupFile" accept="application/json,.json" class="vh" tabindex="-1">
      </div>
      <div id="backupMsg" class="small"></div>
    </div>
    <div class="row"><button type="button" id="closeSettings">Torna all'app</button></div>
    <div class="small muted" id="appVersion"></div>
  </section>
'''
i = s.index('</div>\n\n<nav class="tabs"')
s = s[:i] + settings_html + s[i:]

# errori
rep('''  if (c === "images_unavailable") return "In questa vista non si possono inviare foto.";''',
'''  if (c === "images_unavailable") return "In questa vista non si possono inviare foto.";
  if (c === "no_key") return "Serve la chiave API di Claude: aprila dalle Impostazioni (icona in alto a destra).";
  if (c === "bad_key") return "La chiave API non è valida o non ha credito. Controllala nelle Impostazioni.";
  if (c === "offline") return "Sei offline. Riprova quando hai connessione.";
  if (c === "refused") return "Claude non ha potuto completare questa richiesta.";''')
rep('''const NO_AI = "La lettura delle foto usa Claude, che in questa vista non è disponibile. Apri l'app da claude.ai nel browser (o nell'app Claude) con il tuo account e accetta la richiesta di permesso.";''',
'''const NO_AI = "Un attimo, l'app si sta avviando.";''')

rep('route:null, layouts:{}, dismissed:{}, updatedAt:0}; }', 'route:null, layouts:{}, dismissed:{}, pos:null, nearby:[], flyerMeta:{}, autoFlyers:true, updatedAt:0}; }')
rep('''function render(){
  renderHistory();''', '''function render(){
  renderExtra();
  renderHistory();''')
rep('href="https://www.google.com/maps/search/${encodeURIComponent(s.name + " " + (state.zona || "vicino a me"))}">Portami lì', 'href="${mapsHref(s)}">Portami lì')

# codice nuovo prima di showTab(currentTab);
code = pathlib.Path("src/app-extra.js").read_text()
k = s.rindex('showTab(currentTab);')
s = s[:k] + code + '\n' + s[k:]
pathlib.Path("index.html").write_text(s)
print("ok", len(s))
