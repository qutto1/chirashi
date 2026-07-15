/* チラシまとめ Webアプリ
 * data/latest.json を読んで4店舗のチラシ情報を表示する静的SPA。
 * 買い物リスト選択・非表示設定は localStorage、設定の保存は GitHub Contents API。
 */
"use strict";

const REPO = "qutto1/chirashi";
const CATEGORY_ORDER = ["米・パン", "野菜", "鮮魚", "肉"];
const CAT_CLASS = { "米・パン": "cat-rice", 野菜: "cat-veg", 鮮魚: "cat-fish", 肉: "cat-meat", その他: "cat-other" };
const HIDE_DAYS = 3;
const LS = {
  selected: "chirashi.selected",
  selectedDate: "chirashi.selectedDate",
  ghToken: "chirashi.ghToken",
  hidden: "chirashi.hidden", // key -> 期限(epoch ms)
  gasUrl: "chirashi.gasUrl",
  gasSecret: "chirashi.gasSecret",
};

const App = {
  data: null,
  settings: { notify_time: "08:00", watch_items: [] },
  settingsSha: null,
  selected: {}, // key -> {store, name, price}
  hidden: {},   // key -> expiryMs
};

/* ---------- ユーティリティ ---------- */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const prodKey = (storeId, name) => `${storeId}::${name}`;

/* ---------- 起動 ---------- */
async function init() {
  loadSelected();
  loadHidden();
  bindUI();
  await Promise.all([loadSettings(), loadData()]);
  render();
}

async function loadData() {
  try {
    const res = await fetch(`data/latest.json?t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    App.data = await res.json();
  } catch (e) {
    $("loading").textContent = "チラシデータの読み込みに失敗しました。";
    console.error(e);
  }
}

async function loadSettings() {
  try {
    const res = await fetch(`settings.json?t=${Date.now()}`);
    if (res.ok) App.settings = await res.json();
  } catch (e) {
    console.warn("settings.json 読み込み失敗", e);
  }
}

/* ---------- 選択状態(localStorage) ---------- */
function loadSelected() {
  const today = new Date().toISOString().slice(0, 10);
  if (localStorage.getItem(LS.selectedDate) !== today) {
    localStorage.setItem(LS.selectedDate, today);
    localStorage.removeItem(LS.selected);
    App.selected = {};
    return;
  }
  try {
    App.selected = JSON.parse(localStorage.getItem(LS.selected) || "{}");
  } catch {
    App.selected = {};
  }
}
function saveSelected() {
  localStorage.setItem(LS.selected, JSON.stringify(App.selected));
  updateSelCount();
}
function updateSelCount() {
  $("selCount").textContent = Object.keys(App.selected).length;
}

/* ---------- 3日間非表示(localStorage) ---------- */
function loadHidden() {
  try {
    App.hidden = JSON.parse(localStorage.getItem(LS.hidden) || "{}");
  } catch {
    App.hidden = {};
  }
  // 期限切れを掃除
  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(App.hidden)) {
    if (App.hidden[k] <= now) {
      delete App.hidden[k];
      changed = true;
    }
  }
  if (changed) saveHidden();
}
function saveHidden() {
  localStorage.setItem(LS.hidden, JSON.stringify(App.hidden));
  updateHiddenCount();
}
function isHidden(key) {
  const exp = App.hidden[key];
  return exp && exp > Date.now();
}
function hideProduct(key) {
  App.hidden[key] = Date.now() + HIDE_DAYS * 86400000;
  saveHidden();
}
function unhideProduct(key) {
  delete App.hidden[key];
  saveHidden();
}
function updateHiddenCount() {
  const n = Object.keys(App.hidden).length;
  const badge = $("hiddenCount");
  badge.textContent = n;
  badge.hidden = n === 0;
}

/* ---------- 描画 ---------- */
function render() {
  updateSelCount();
  updateHiddenCount();
  if (!App.data) return;
  $("loading").hidden = true;

  const d = App.data.date || "";
  $("dateLabel").textContent = d ? `${d} のチラシ情報` : "";

  renderWatchHits();

  const container = $("stores");
  container.innerHTML = "";
  (App.data.stores || []).forEach((store) => container.appendChild(renderStore(store)));
}

function renderWatchHits() {
  const box = $("watchHits");
  const hits = App.data.watch_hits || [];
  if (!hits.length) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `🔔 チェック中の商品が掲載されています: ` +
    hits.map((h) => `<b>${esc(h)}</b>`).join("、");
}

function renderStore(store) {
  const card = el("div", "store");

  const head = el("div", "store-head");
  head.innerHTML =
    `<h2>${esc(store.name)}</h2>` +
    (store.url ? `<a href="${esc(store.url)}" target="_blank" rel="noopener">元のチラシページを開く ↗</a>` : "");
  card.appendChild(head);

  if (store.flyer_images && store.flyer_images.length) {
    const thumbs = el("div", "flyer-thumbs");
    store.flyer_images.forEach((src) => {
      const img = el("img");
      img.src = src;
      img.loading = "lazy";
      img.addEventListener("click", () => openImage(src));
      thumbs.appendChild(img);
    });
    card.appendChild(thumbs);
  }

  // 非表示中の商品を除外して区分ごとにグループ化
  const byCat = {};
  (store.products || []).forEach((p) => {
    if (isHidden(prodKey(store.id, p.name))) return;
    const cat = CATEGORY_ORDER.includes(p.category) ? p.category : "その他";
    (byCat[cat] = byCat[cat] || []).push(p);
  });

  // 区分順に描画。商品ゼロの区分は表示しない(byCatに無いのでスキップ)。
  CATEGORY_ORDER.forEach((cat) => {
    if (byCat[cat] && byCat[cat].length) card.appendChild(renderCategory(store, cat, byCat[cat], false));
  });
  if (byCat["その他"] && byCat["その他"].length) {
    card.appendChild(renderCategory(store, "その他", byCat["その他"], true));
  }

  return card;
}

function renderCategory(store, cat, products, collapsed) {
  if (collapsed) {
    const details = el("details", "cat-other");
    details.appendChild(el("summary", null, `その他 (${products.length}品)`));
    details.appendChild(buildTable(store, products));
    return details;
  }
  const sec = el("div", "cat-section " + CAT_CLASS[cat]);
  sec.appendChild(el("div", "cat-title", `${cat} (${products.length}品)`));
  sec.appendChild(buildTable(store, products));
  return sec;
}

function buildTable(store, products) {
  const table = el("table", "products");
  const tbody = el("tbody");
  products.forEach((p) => tbody.appendChild(buildRow(store, p)));
  table.appendChild(tbody);
  return table;
}

function isWatched(name) {
  return (App.settings.watch_items || []).some((w) => w && name.includes(w));
}

function buildRow(store, p) {
  const key = prodKey(store.id, p.name);
  const tr = el("tr");
  if (App.selected[key]) tr.classList.add("selected");
  if (isWatched(p.name)) tr.classList.add("watch");

  // 追加ボタン
  const tdAdd = el("td", "col-add");
  const btn = el("button", "add-btn", App.selected[key] ? "✓" : "＋");
  btn.addEventListener("click", () => toggleSelect(store, p, tr, btn));
  tdAdd.appendChild(btn);

  // 産地 (国内/国外のみ、不明は空)
  const tdOrigin = el("td", "col-origin");
  if (p.origin === "国内") tdOrigin.innerHTML = `<span class="origin-tag origin-jp">国内</span>`;
  else if (p.origin === "国外") tdOrigin.innerHTML = `<span class="origin-tag origin-fr">国外</span>`;

  // 商品名(レシピリンク) + 連日なら期間バッジ("本日のみ"は非表示)
  const tdName = el("td", "col-name");
  const a = el("a", "prod-name", esc(p.name));
  a.addEventListener("click", () => openRecipes(p));
  tdName.appendChild(a);
  if (p.period && p.period !== "本日のみ") {
    tdName.appendChild(el("span", "period-badge", esc(p.period)));
  }

  // 価格単位(商品名と価格の間)
  const tdUnit = el("td", "col-unit", esc(p.unit || ""));

  // 価格
  const tdPrice = el("td", "col-price", esc(p.price || ""));

  // 3日間非表示ボタン
  const tdHide = el("td", "col-hide");
  const hideBtn = el("button", "hide-btn", "3日間非表示");
  hideBtn.addEventListener("click", () => {
    // 選択中なら解除してから非表示
    if (App.selected[key]) { delete App.selected[key]; saveSelected(); }
    hideProduct(key);
    tr.remove();
  });
  tdHide.appendChild(hideBtn);

  tr.append(tdAdd, tdOrigin, tdName, tdUnit, tdPrice, tdHide);
  return tr;
}

function toggleSelect(store, p, tr, btn) {
  const key = prodKey(store.id, p.name);
  if (App.selected[key]) {
    delete App.selected[key];
    tr.classList.remove("selected");
    btn.textContent = "＋";
  } else {
    App.selected[key] = { store: store.name, name: p.name, unit: p.unit || "", price: p.price || "" };
    tr.classList.add("selected");
    btn.textContent = "✓";
  }
  saveSelected();
}

/* ---------- LINEへ送信 (選択商品) ---------- */
function sendSelectedToLine() {
  const items = Object.values(App.selected);
  if (!items.length) {
    alert("送信する商品が選択されていません。各商品の「＋」ボタンで選択してください。");
    return;
  }
  const lines = ["🛒 買い物リスト", ""];
  const byStore = {};
  items.forEach((it) => (byStore[it.store] = byStore[it.store] || []).push(it));
  Object.keys(byStore).forEach((s) => {
    lines.push(`【${s}】`);
    byStore[s].forEach((it) => lines.push(`・${it.name}  ${it.unit ? it.unit + " " : ""}${it.price}`));
    lines.push("");
  });
  shareToLine(lines.join("\n").trim());
}

// LINE送信: GAS中継が設定済みなら通知先へ直接プッシュ、未設定なら共有ピッカー。
async function shareToLine(text) {
  const gasUrl = localStorage.getItem(LS.gasUrl);
  const gasSecret = localStorage.getItem(LS.gasSecret) || "";
  if (gasUrl) {
    try {
      // text/plain にして preflight(OPTIONS) を避ける(GASはCORSプリフライト非対応)
      const res = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ secret: gasSecret, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        toast("LINEに送信しました（通知先へ）");
      } else {
        toast("送信に失敗しました: " + (data.error || data.status || "不明"));
      }
    } catch (e) {
      console.error(e);
      toast("送信に失敗しました（中継URLを確認してください）");
    }
    return;
  }
  // フォールバック: 共有ピッカー
  const url = "https://line.me/R/share?text=" + encodeURIComponent(text);
  window.open(url, "_blank", "noopener");
}

function toast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = el("div", "toast");
    t.id = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---------- 非表示管理モーダル ---------- */
function openHiddenManager() {
  const ul = $("hiddenList");
  ul.innerHTML = "";
  const keys = Object.keys(App.hidden).filter((k) => App.hidden[k] > Date.now());
  if (!keys.length) {
    ul.appendChild(el("li", "hint", "非表示中の商品はありません。"));
  } else {
    // 商品名・店舗を data から引く
    const nameOf = {};
    (App.data?.stores || []).forEach((s) =>
      (s.products || []).forEach((p) => (nameOf[prodKey(s.id, p.name)] = { store: s.name, name: p.name }))
    );
    keys.sort((a, b) => App.hidden[a] - App.hidden[b]);
    keys.forEach((key) => {
      const info = nameOf[key] || { store: key.split("::")[0], name: key.split("::")[1] };
      const remainMs = App.hidden[key] - Date.now();
      const remainDays = Math.ceil(remainMs / 86400000);
      const li = el("li");
      const left = el("div");
      left.appendChild(el("div", null, esc(info.name)));
      left.appendChild(el("div", "hl-meta", `${esc(info.store)} ・ あと約${remainDays}日`));
      li.appendChild(left);
      const btn = el("button", null, "再表示");
      btn.addEventListener("click", () => {
        unhideProduct(key);
        openHiddenManager(); // 再描画
        render();            // 一覧にも即反映
      });
      li.appendChild(btn);
      ul.appendChild(li);
    });
  }
  showModal("hiddenModal");
}

/* ---------- レシピモーダル ---------- */
function openRecipes(p) {
  $("recipeTitle").textContent = `「${p.name}」のレシピ`;
  const body = $("recipeBody");
  body.innerHTML = "";

  const recipes = p.recipes || [];
  if (!recipes.length) {
    const q = encodeURIComponent(p.name);
    body.innerHTML =
      `<div class="recipe-empty">事前取得したレシピがありません。<br>` +
      `<a href="https://recipe.rakuten.co.jp/search/${q}/" target="_blank" rel="noopener">楽天レシピで「${esc(p.name)}」を検索 ↗</a></div>`;
    showModal("recipeModal");
    return;
  }

  recipes.forEach((r) => {
    const card = el("div", "recipe-card");
    if (r.thumb) {
      const img = el("img");
      img.src = r.thumb;
      img.loading = "lazy";
      card.appendChild(img);
    }
    const a = el("a", "rc-title", esc(r.title || "レシピ"));
    a.href = r.url;
    a.target = "_blank";
    a.rel = "noopener";
    card.appendChild(a);

    const send = el("button", "btn btn-line", "LINEへ送信");
    send.addEventListener("click", () => shareToLine(`🍳 ${r.title}\n${r.url}`));
    card.appendChild(send);
    body.appendChild(card);
  });
  showModal("recipeModal");
}

/* ---------- 画像モーダル ---------- */
function openImage(src) {
  $("imageModalImg").src = src;
  showModal("imageModal");
}

/* ---------- 設定モーダル ---------- */
function openSettings() {
  $("notifyTime").value = App.settings.notify_time || "08:00";
  $("ghToken").value = localStorage.getItem(LS.ghToken) || "";
  $("gasUrl").value = localStorage.getItem(LS.gasUrl) || "";
  $("gasSecret").value = localStorage.getItem(LS.gasSecret) || "";
  renderWatchList();
  $("saveStatus").textContent = "";
  showModal("settingsModal");
}

function renderWatchList() {
  const ul = $("watchList");
  ul.innerHTML = "";
  (App.settings.watch_items || []).forEach((item, i) => {
    const li = el("li");
    li.appendChild(el("span", null, esc(item)));
    const del = el("button", null, "🗑");
    del.addEventListener("click", () => {
      App.settings.watch_items.splice(i, 1);
      renderWatchList();
    });
    li.appendChild(del);
    ul.appendChild(li);
  });
  if (!(App.settings.watch_items || []).length) {
    ul.appendChild(el("li", "hint", "登録なし"));
  }
}

function addWatchItem() {
  const inp = $("watchInput");
  const v = inp.value.trim();
  if (!v) return;
  App.settings.watch_items = App.settings.watch_items || [];
  if (!App.settings.watch_items.includes(v)) App.settings.watch_items.push(v);
  inp.value = "";
  renderWatchList();
}

async function saveSettings() {
  App.settings.notify_time = $("notifyTime").value || "08:00";
  const token = $("ghToken").value.trim();
  if (token) localStorage.setItem(LS.ghToken, token);

  // GAS中継設定(端末ローカル保存)
  const gasUrl = $("gasUrl").value.trim();
  const gasSecret = $("gasSecret").value.trim();
  if (gasUrl) localStorage.setItem(LS.gasUrl, gasUrl); else localStorage.removeItem(LS.gasUrl);
  if (gasSecret) localStorage.setItem(LS.gasSecret, gasSecret); else localStorage.removeItem(LS.gasSecret);

  const status = $("saveStatus");
  if (!token) {
    status.textContent = "トークン未設定のため保存できません（設定は次回開くまで保持）。";
    return;
  }

  status.textContent = "保存中…";
  try {
    await commitSettings(token);
    status.textContent = "✅ 保存しました。反映まで数十秒かかることがあります。";
  } catch (e) {
    console.error(e);
    status.textContent = "❌ 保存に失敗: " + e.message;
  }
}

async function commitSettings(token) {
  const path = "settings.json";
  const apiBase = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  let sha = App.settingsSha;
  if (!sha) {
    const cur = await fetch(apiBase, { headers });
    if (cur.ok) sha = (await cur.json()).sha;
  }

  const content = {
    notify_time: App.settings.notify_time,
    watch_items: App.settings.watch_items || [],
  };
  const body = {
    message: `設定更新: 通知${content.notify_time} / チェック${content.watch_items.length}件`,
    content: b64utf8(JSON.stringify(content, null, 2) + "\n"),
  };
  if (sha) body.sha = sha;

  const res = await fetch(apiBase, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t.slice(0, 120)}`);
  }
  App.settingsSha = (await res.json()).content.sha;
}

function b64utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/* ---------- モーダル制御 ---------- */
function showModal(id) { $(id).hidden = false; }
function hideModal(id) { $(id).hidden = true; }

/* ---------- イベント ---------- */
function bindUI() {
  $("btnSend").addEventListener("click", sendSelectedToLine);
  $("btnHidden").addEventListener("click", openHiddenManager);
  $("btnCloseHidden").addEventListener("click", () => hideModal("hiddenModal"));
  $("btnSettings").addEventListener("click", openSettings);
  $("btnCloseSettings").addEventListener("click", () => hideModal("settingsModal"));
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnAddWatch").addEventListener("click", addWatchItem);
  $("watchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addWatchItem(); });
  $("btnCloseRecipe").addEventListener("click", () => hideModal("recipeModal"));
  $("btnCloseImage").addEventListener("click", () => hideModal("imageModal"));

  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; });
  });
}

init();
