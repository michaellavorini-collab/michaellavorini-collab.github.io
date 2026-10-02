/* ---------- solo app installabile: impostazioni, GPS, volantini online, backup ---------- */
const APP_VERSION = "1.0.0";
const SET_TAB = "impostazioni";

function hasKey(){ return !!(window.claudeSettings && window.claudeSettings.apiKey); }
function renderKeyBanner(){ $("#keyBanner").hidden = hasKey() || currentTab === SET_TAB; }

/* impostazioni */
(function initSettings(){
  const sel = $("#aiModel");
  (window.claudeModels || []).forEach(m => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.label; sel.appendChild(o); });
  if (window.claudeSettings) { $("#apiKey").value = claudeSettings.apiKey; sel.value = claudeSettings.model; }
  $("#appVersion").textContent = "Spesa Furba " + APP_VERSION;
  const open = () => { showTab(SET_TAB); renderKeyBanner(); };
  $("#openSettings").onclick = open; $("#keyBannerBtn").onclick = open;
  $("#closeSettings").onclick = () => { showTab("lista"); renderKeyBanner(); };
  $("#apiKeyShow").onclick = () => { const i = $("#apiKey"); i.type = i.type === "password" ? "text" : "password"; $("#apiKeyShow").textContent = i.type === "password" ? "Mostra" : "Nascondi"; };
  sel.onchange = () => { claudeSettings.model = sel.value; };
  $("#apiSave").onclick = async () => {
    const btn = $("#apiSave"), msg = $("#apiMsg");
    claudeSettings.apiKey = $("#apiKey").value; claudeSettings.model = sel.value;
    if (!claudeSettings.apiKey){ msg.innerHTML = `<span class="err">Incolla la chiave API, inizia con sk-ant-.</span>`; renderKeyBanner(); return; }
    busy(btn, true, "Provo…");
    try { await sample.test(); msg.innerHTML = `<span class="tag ok">Chiave funzionante</span>`; }
    catch(e){ msg.innerHTML = `<span class="err">${esc(aiError(e))}</span>`; }
    busy(btn, false); renderKeyBanner();
  };
  $("#autoFlyers").onchange = e => { state.autoFlyers = e.target.checked; save(); };
})();

/* backup */
$("#backupSave").onclick = () => {
  const data = JSON.stringify({app:"spesa-furba", version:1, savedAt:new Date().toISOString(), state, receipts}, null, 1);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], {type:"application/json"}));
  a.download = `spesa-furba-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  $("#backupMsg").innerHTML = `<span class="tag ok">Copia salvata nei Download</span>`;
};
$("#backupFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    const st = d.state || d;
    if (!st || !Array.isArray(st.items)) throw new Error("formato");
    state = normalize(st); state.updatedAt = Date.now();
    if (Array.isArray(d.receipts)) { receipts = d.receipts; saveReceiptsLocal(); }
    save();
    $("#backupMsg").innerHTML = `<span class="tag ok">Dati ripristinati</span>`;
  } catch(err){ $("#backupMsg").innerHTML = `<span class="err">Il file non è una copia di Spesa Furba.</span>`; }
});

/* GPS e supermercati vicini (OpenStreetMap) */
function chainFor(brand){
  const b = String(brand || "").toLowerCase();
  const hit = CHAINS.find(c => new RegExp("(^|[^a-z])" + c.toLowerCase() + "([^a-z]|$)").test(b));
  return hit || String(brand || "").trim();
}
function distKm(a, b){
  const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLat/2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function mapsHref(s){
  if (s && s.lat != null) return `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`;
  return "https://www.google.com/maps/search/" + encodeURIComponent((s ? s.name : "supermercati") + " " + (state.zona || "vicino a me"));
}
function renderNearby(){
  const box = $("#nearby"); box.innerHTML = "";
  for (const n of (state.nearby || []).slice(0, 15)){
    const chain = chainFor(n.brand || n.name);
    const on = state.stores.some(s => s.name.toLowerCase() === chain.toLowerCase());
    const d = document.createElement("div"); d.className = "sugg";
    d.innerHTML = `<div class="info"><span>${esc(n.name)}</span><span>${n.km.toFixed(1).replace(".", ",")} km${n.addr ? " · " + esc(n.addr) : ""}</span></div><a class="btn" target="_blank" rel="noopener" href="${mapsHref(n)}">Vai ↗</a><button type="button" class="${on ? "" : "primary"}">${on ? "Scelto" : "Scegli"}</button>`;
    d.querySelector("button").onclick = () => {
      if (on) return;
      state.stores.push({id:uid(), name:chain, lat:n.lat, lon:n.lon, addr:n.addr || ""});
      save();
    };
    box.appendChild(d);
  }
}
$("#gpsBtn").onclick = () => {
  const msg = $("#gpsMsg"), btn = $("#gpsBtn");
  if (!navigator.geolocation){ msg.innerHTML = `<span class="err">Questo telefono non dà la posizione al browser.</span>`; return; }
  busy(btn, true, "Cerco…"); msg.textContent = "";
  navigator.geolocation.getCurrentPosition(async pos => {
    const p = {lat:pos.coords.latitude, lon:pos.coords.longitude};
    state.pos = {...p, at:Date.now()};
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=it&lat=${p.lat}&lon=${p.lon}`);
      const j = await r.json(); const a = j.address || {};
      const city = a.city || a.town || a.village || a.municipality || "";
      if (city) state.zona = [city, a.postcode].filter(Boolean).join(" ");
    } catch(e){}
    try {
      const q = `[out:json][timeout:20];nwr["shop"="supermarket"](around:4000,${p.lat},${p.lon});out center tags 60;`;
      const r = await fetch("https://overpass-api.de/api/interpreter", {method:"POST", body:"data=" + encodeURIComponent(q), headers:{"Content-Type":"application/x-www-form-urlencoded"}});
      const j = await r.json();
      state.nearby = (j.elements || []).map(e => {
        const t = e.tags || {}; const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
        if (lat == null) return null;
        const addr = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
        return {name:t.name || t.brand || "Supermercato", brand:t.brand || t.name || "", lat, lon, addr, km:distKm(p, {lat, lon})};
      }).filter(Boolean).sort((a,b) => a.km - b.km).slice(0, 25);
      msg.innerHTML = state.nearby.length ? `<span class="tag ok">${state.nearby.length} supermercati entro 4 km${state.zona ? " · " + esc(state.zona) : ""}</span>` : `<span class="muted">Nessun supermercato trovato entro 4 km.</span>`;
    } catch(e){ msg.innerHTML = `<span class="err">Non riesco a cercare i supermercati vicini. Controlla la connessione e riprova.</span>`; }
    busy(btn, false); save();
  }, err => {
    busy(btn, false);
    msg.innerHTML = `<span class="err">${err.code === 1 ? "Hai negato la posizione. Abilitala per Spesa Furba nelle impostazioni del telefono." : "Non riesco a leggere la posizione. Riprova all'aperto o con il GPS acceso."}</span>`;
  }, {enableHighAccuracy:true, timeout:15000, maximumAge:300000});
};

/* volantini online: Claude cerca e legge le pagine dei volantini */
async function fetchFlyerOnline(store, signal){
  const zona = state.zona || "Italia";
  const r = await sample.json(`Oggi è il ${today()}. Trova il volantino delle offerte in corso oggi del supermercato ${store.name} valido per la zona ${zona}${store.addr ? " (punto vendita in " + store.addr + ")" : ""}.
Usa la ricerca web e leggi le pagine: il sito ufficiale della catena, e siti di volantini come DoveConviene, PromoQui, VolantinoFacile, Tiendeo. Preferisci il volantino della regione o della città indicata.
Estrai le offerte di prodotti con il prezzo in offerta e, se c'è, il prezzo prima dello sconto. Riporta solo offerte che hai letto davvero nelle pagine: non inventare prodotti né prezzi. Se non trovi un volantino in corso, rispondi con trovato false.
Rispondi SOLO con JSON: {"trovato":true,"validoDal":"AAAA-MM-GG" oppure null,"validoFino":"AAAA-MM-GG" oppure null,"fonte":"url della pagina principale","offerte":[{"prodotto":"nome con marca e formato","prezzo":0.00,"prezzoPrima":null}]}`,
    {web:true, city:String(zona).replace(/\d+/g, "").trim() || undefined, modelTier:"default", signal});
  const list = (r && r.trovato !== false && Array.isArray(r.offerte)) ? r.offerte.filter(o => o.prodotto && isFinite(Number(o.prezzo)) && Number(o.prezzo) > 0) : [];
  const until = r && /^\d{4}-\d{2}-\d{2}$/.test(r.validoFino || "") ? r.validoFino : null;
  state.flyerMeta = state.flyerMeta || {};
  state.flyerMeta[store.id] = {at:Date.now(), until, fonte:(r && r.fonte) || "", n:list.length};
  if (list.length){
    state.offers = state.offers.filter(o => o.storeId !== store.id);
    for (const o of list){ const was = Number(o.prezzoPrima); state.offers.push({id:uid(), storeId:store.id, product:String(o.prodotto).trim(), price:Number(o.prezzo), was:isFinite(was) && was > Number(o.prezzo) ? was : null, until, added:today(), online:true}); }
  }
  save();
  return {n:list.length, until};
}
async function runOnline(stores, opts = {}){
  const msg = $("#flyerMsg"), prog = $("#flyerProg"), progTxt = $("#flyerProgTxt");
  if (!hasKey()){ if (!opts.silent) msg.innerHTML = `<span class="err">${esc(aiError({code:"no_key"}))}</span>`; return; }
  if (!stores.length){ if (!opts.silent) msg.innerHTML = `<span class="err">Scegli prima almeno un supermercato.</span>`; return; }
  flyerAbort = new AbortController();
  prog.hidden = false; msg.textContent = "";
  const done = [];
  for (let i = 0; i < stores.length; i++){
    if (flyerAbort.signal.aborted) break;
    const s = stores[i];
    progTxt.textContent = `Cerco il volantino di ${s.name}${stores.length > 1 ? ` (${i + 1} di ${stores.length})` : ""}… può volerci un minuto`;
    if (opts.silent) setSync(`Aggiorno il volantino di ${s.name}…`);
    try { const r = await fetchFlyerOnline(s, flyerAbort.signal); done.push(`${s.name}: ${r.n ? r.n + " offerte" + (r.until ? " fino al " + r.until.split("-").reverse().join("/") : "") : "nessun volantino trovato"}`); }
    catch(e){ if (e && e.code === "cancelled") break; done.push(`${s.name}: ${aiError(e)}`); if (e && (e.code === "bad_key" || e.code === "no_key" || e.code === "offline")) break; }
  }
  prog.hidden = true; flyerAbort = null;
  if (opts.silent) setSync("Volantini aggiornati");
  msg.innerHTML = done.map(t => `<div>${esc(t)}</div>`).join("");
}
$("#webFlyer").onclick = () => { const s = state.stores.find(x => x.id === $("#flyerStore").value); runOnline(s ? [s] : []); };
$("#webFlyerAll").onclick = () => runOnline(state.stores.slice());
function staleStores(){
  const d = today(), meta = state.flyerMeta || {};
  return state.stores.filter(s => { const m = meta[s.id]; return !m || (Date.now() - m.at) > 3 * 864e5 || (m.until && m.until < d); });
}
setTimeout(() => {
  if (state.autoFlyers && hasKey() && navigator.onLine !== false) { const st = staleStores(); if (st.length) runOnline(st, {silent:true}); }
}, 2500);

function renderExtra(){
  renderKeyBanner();
  renderNearby();
  $("#autoFlyers").checked = !!state.autoFlyers;
}

/* app installabile */
if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch(e){}

/* scorciatoie dall'icona: #lista, #carte, … */
{ const h = location.hash.slice(1); if (["lista","confronta","ricette","carte","storico"].includes(h)) currentTab = h; }
