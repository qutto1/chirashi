/* チラシまとめ Webアプリ
 * data/latest.json を読んで3店舗のチラシ情報を表示する静的SPA。
 * 買い物リスト選択・設定は localStorage、設定の保存は GitHub Contents API。
 */
"use strict";

const REPO = "qutto1/chirashi";
const CATEGORY_ORDER = ["野菜", "鮮魚", "肉"];
const LS = {
  selected: "chirashi.selected",
  selectedDate: "chirashi.selectedDate",
  ghToken: "chirashi.ghToken",
};

const App = {
  data: null,
  settings: { notify_time: "08:00", watch_items: [] },
  settingsSha: null,
  selected: {}, // key -> {store, name, price}
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
    // 日付が変わったら選択をリセット
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

/* ---------- 描画 ---------- */
function render() {
  updateSelCount();
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

  // チラシ画像サムネイル
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

  // 区分ごとにグループ化
  const byCat = {};
  (store.products || []).forEach((p) => {
    const cat = CATEGORY_ORDER.includes(p.category) ? p.category : "その他";
    (byCat[cat] = byCat[cat] || []).push(p);
  });

  CATEGORY_ORDER.forEach((cat) => {
    if (byCat[cat]) card.appendChild(renderCategory(store, cat, byCat[cat], false));
  });
  if (byCat["その他"]) card.appendChild(renderCategory(store, "その他", byCat["その他"], true));

  return card;
}

const CAT_CLASS = { 野菜: "cat-veg", 鮮魚: "cat-fish", 肉: "cat-meat", その他: "cat-other" };

function renderCategory(store, cat, products, collapsed) {
  if (collapsed) {
    const details = el("details", "cat-other");
    const summary = el("summary", null, `その他 (${products.length}品)`);
    details.appendChild(summary);
    details.appendChild(buildPeriodGroups(store, products));
    return details;
  }
  const sec = el("div", "cat-section " + CAT_CLASS[cat]);
  sec.appendChild(el("div", "cat-title", `${cat} (${products.length}品)`));
  sec.appendChild(buildPeriodGroups(store, products));
  return sec;
}

// 「本日のみ」と「連日」に分けて表示
function buildPeriodGroups(store, products) {
  const frag = document.createDocumentFragment();
  const today = products.filter((p) => p.period === "本日のみ");
  const multi = products.filter((p) => p.period !== "本日のみ");

  if (today.length) {
    const g = el("div", "period-group");
    g.appendChild(el("span", "period-label today", "本日のみ"));
    g.appendChild(buildTable(store, today));
    frag.appendChild(g);
  }
  if (multi.length) {
    const g = el("div", "period-group");
    g.appendChild(el("span", "period-label multi", "連日"));
    g.appendChild(buildTable(store, multi));
    frag.appendChild(g);
  }
  return frag;
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

  // 商品名 (レシピリンク)
  const tdName = el("td", "col-name");
  const a = el("a", "prod-name", esc(p.name));
  a.addEventListener("click", () => openRecipes(p));
  tdName.appendChild(a);

  // 価格
  const tdPrice = el("td", "col-price", esc(p.price || ""));

  tr.append(tdAdd, tdOrigin, tdName, tdPrice);
  return tr;
}

function toggleSelect(store, p, tr, btn) {
  const key = prodKey(store.id, p.name);
  if (App.selected[key]) {
    delete App.selected[key];
    tr.classList.remove("selected");
    btn.textContent = "＋";
  } else {
    App.selected[key] = { store: store.name, name: p.name, price: p.price || "" };
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
    byStore[s].forEach((it) => lines.push(`・${it.name}  ${it.price}`));
    lines.push("");
  });
  shareToLine(lines.join("\n").trim());
}

function shareToLine(text) {
  const url = "https://line.me/R/share?text=" + encodeURIComponent(text);
  window.open(url, "_blank", "noopener");
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
      `<a href="https://cookpad.com/jp/search/${q}" target="_blank" rel="noopener">クックパッドで「${esc(p.name)}」を検索 ↗</a></div>`;
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
    send.addEventListener("click", () =>
      shareToLine(`🍳 ${r.title}\n${r.url}`)
    );
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

// GitHub Contents API で settings.json を更新
async function commitSettings(token) {
  const path = "settings.json";
  const apiBase = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  // 最新の sha を取得
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

// UTF-8 安全な base64 エンコード
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
  $("btnSettings").addEventListener("click", openSettings);
  $("btnCloseSettings").addEventListener("click", () => hideModal("settingsModal"));
  $("btnSaveSettings").addEventListener("click", saveSettings);
  $("btnAddWatch").addEventListener("click", addWatchItem);
  $("watchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addWatchItem(); });
  $("btnCloseRecipe").addEventListener("click", () => hideModal("recipeModal"));
  $("btnCloseImage").addEventListener("click", () => hideModal("imageModal"));

  // 背景クリックで閉じる
  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; });
  });
}

init();
