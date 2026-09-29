/* チラシまとめ Webアプリ
 * data/latest.json を読んで4店舗のチラシ情報を表示する静的SPA。
 * 買い物リスト選択・非表示設定は localStorage、設定の保存は GitHub Contents API。
 */
"use strict";

const REPO = "qutto1/chirashi";
const CATEGORY_ORDER = ["米・パン", "野菜", "鮮魚", "肉"];
// レシピ優先プルダウンの対象区分(この順を第1ソートキーにする)
const RECIPE_CATS = ["野菜", "鮮魚", "肉"];
const CAT_CLASS = { "米・パン": "cat-rice", 野菜: "cat-veg", 鮮魚: "cat-fish", 肉: "cat-meat", その他: "cat-other" };
const HIDE_DAYS = 3;
const LS = {
  selected: "chirashi.selected",
  selectedDate: "chirashi.selectedDate",
  ghToken: "chirashi.ghToken",
  hidden: "chirashi.hidden", // key -> 期限(epoch ms)
  gasUrl: "chirashi.gasUrl",
  gasSecret: "chirashi.gasSecret",
  catFilter: "chirashi.catFilter", // 表示区分(単一選択): "全て" | 区分名
  settings: "chirashi.settings", // 通知時刻+常時チェック商品の端末ローカル退避
  settingsBase: "chirashi.settingsBase", // 最後にGitHubと一致を確認した設定(未反映の編集の判定用)
};

const App = {
  data: null,
  settings: { notify_time: "08:00", watch_items: [] },
  settingsSha: null,
  remote: null,      // GitHub上の設定(=毎朝のLINE通知が読む正)。取得失敗時は null
  syncError: "",     // 直近のGitHub反映エラー
  selected: {}, // key -> {store, name, price}
  hidden: {},   // key -> expiryMs
  catFilter: "全て", // 表示区分(単一選択)。"全て" または区分名
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
  loadCatFilter();
  bindUI();
  await Promise.all([loadSettings(), loadData()]);
  render();
}

/* ---------- 表示区分(単一選択, localStorage) ---------- */
function loadCatFilter() {
  const saved = localStorage.getItem(LS.catFilter);
  // "全て" または既知の区分名のみ有効。既定は "全て"。
  App.catFilter = saved && (saved === "全て" || CATEGORY_ORDER.includes(saved)) ? saved : "全て";
}
function saveCatFilter() {
  localStorage.setItem(LS.catFilter, App.catFilter);
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

/* ---------- 設定(通知時刻+常時チェック商品)の同期 ----------
 * 毎朝のLINE通知が読むのは GitHub 上の settings.json だけ。端末ローカルに保存しただけでは
 * LINE通知に反映されない。以前は「追加・削除は端末に保存、GitHubへは保存ボタンで送信」だったため、
 * 画面には反映済みのように見えるのにLINEは古い設定のまま、という食い違いが起きた(2026-09-29)。
 * → 編集のたびに自動でGitHubへ反映し、反映済みかどうかを常に画面に出す。
 */
const normSettings = (s) => ({
  notify_time: (s && s.notify_time) || "08:00",
  watch_items: ((s && s.watch_items) || []).filter(Boolean),
});
const sameSettings = (a, b) => {
  const x = normSettings(a), y = normSettings(b);
  return x.notify_time === y.notify_time &&
    JSON.stringify([...x.watch_items].sort()) === JSON.stringify([...y.watch_items].sort());
};
const readLS = (k) => {
  try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; }
};
const isSynced = () => !!App.remote && sameSettings(App.settings, App.remote);

async function loadSettings() {
  // まずリモート settings.json(バックエンド=毎朝の通知が参照する正)を読む
  let remote = null;
  try {
    const res = await fetch(`settings.json?t=${Date.now()}`, { cache: "no-store" });
    if (res.ok) remote = normSettings(await res.json());
  } catch (e) {
    console.warn("settings.json 読み込み失敗", e);
  }
  App.remote = remote;

  const local = readLS(LS.settings);
  const base = readLS(LS.settingsBase);
  if (!remote) {
    // 取得できない時は端末ローカルで表示だけ続ける
    App.settings = normSettings(local);
    return;
  }
  // 未反映のローカル編集がある = ローカルが「最後に同期した内容(base)」から変わっている。
  // 未反映ならローカルを優先。そうでなければリモートを採用(別端末での更新を取り込む)。
  // base が無い旧版の端末は「リモートと違う」ことを未反映とみなす。
  const pending = !!local && !sameSettings(local, base || remote);
  // remote と同一オブジェクトを共有すると、編集がリモート側の記録まで書き換えて常に「反映済み」に見える
  App.settings = normSettings(pending ? local : remote);
  if (!pending) {
    saveSettingsLocal();
    localStorage.setItem(LS.settingsBase, JSON.stringify(remote));
  }
  scheduleSync(0); // 未反映が残っていれば(PATがあれば)すぐ反映する
}

// 通知時刻+常時チェック商品を端末ローカルに退避(即時・PAT不要)
function saveSettingsLocal() {
  localStorage.setItem(LS.settings, JSON.stringify(normSettings(App.settings)));
}

// 編集の都度: 端末へ退避 → GitHubへ自動反映(PATがあれば)→ 表示更新
function onSettingsEdited() {
  saveSettingsLocal();
  scheduleSync();
}

let syncTimer = null;
let syncRunning = false;
let syncRerun = false;
let syncFails = 0;

function scheduleSync(delay = 800) {
  updateSyncUI();
  if (!localStorage.getItem(LS.ghToken) || isSynced()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, delay);
}

async function runSync() {
  const token = localStorage.getItem(LS.ghToken);
  if (!token) { updateSyncUI(); return; }
  if (syncRunning) { syncRerun = true; return; }
  syncRunning = true;
  App.syncError = "";
  updateSyncUI();
  try {
    do {
      syncRerun = false;
      if (!isSynced()) await commitSettings(token);
    } while (syncRerun);
    syncFails = 0;
  } catch (e) {
    console.error(e);
    App.syncError = e.message;
    // 一時的な失敗は少し待って自動再試行(トークン不正などで延々続かないよう3回まで)
    if (++syncFails <= 3) { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, 30000); }
  } finally {
    syncRunning = false;
    updateSyncUI();
  }
}

function updateSyncUI() {
  const synced = isSynced();
  const hasToken = !!localStorage.getItem(LS.ghToken);
  let text, cls;
  if (synced) {
    text = "✅ LINE通知に反映済み"; cls = "ok";
  } else if (syncRunning) {
    text = "⏳ LINE通知へ反映中…"; cls = "wait";
  } else if (!hasToken) {
    text = "⚠ この端末だけの変更です。LINE通知にはまだ反映されていません。" +
      "下の「保存用トークン」を設定して「保存」を押すと反映されます。";
    cls = "warn";
  } else if (App.syncError) {
    text = "❌ LINE通知への反映に失敗: " + App.syncError + "（自動で再試行します）"; cls = "warn";
  } else {
    text = "⏳ LINE通知への反映待ち…"; cls = "wait";
  }
  const st = $("syncStatus");
  if (st) { st.textContent = text; st.className = "sync-status " + cls; }
  const gear = $("btnSettings");
  if (gear) gear.classList.toggle("dirty", !synced);
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
  updateHiddenCount();
  if (!App.data) return;
  $("loading").hidden = true;

  renderCatFilter();
  renderWatchHits();

  const container = $("stores");
  container.innerHTML = "";
  (App.data.stores || []).forEach((store) => container.appendChild(renderStore(store)));
}

// 上部の表示区分バー(「全て」+4区分の単一選択。どれか1つのみON)
function renderCatFilter() {
  const bar = $("catFilter");
  bar.innerHTML = "";
  bar.appendChild(el("span", "cat-filter-label", "表示区分:"));
  ["全て", ...CATEGORY_ORDER].forEach((opt) => {
    const on = App.catFilter === opt;
    const cls = opt === "全て" ? "cat-all" : (CAT_CLASS[opt] || "");
    const btn = el("button", "cat-toggle " + cls + (on ? " on" : ""), esc(opt));
    btn.addEventListener("click", () => {
      App.catFilter = opt;
      saveCatFilter();
      render();
    });
    bar.appendChild(btn);
  });
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

  // 商品が0件の店は理由を明示する(真っ白だと不具合か掲載なしか分からない)
  if (!(store.products || []).length) {
    const failed = store.status === "failed";
    card.appendChild(el("div", "store-empty" + (failed ? " warn" : ""),
      failed ? "⚠ 今回は情報を取得できませんでした。「元のチラシページ」で確認してください。"
        : store.status === "no_flyer" ? "本日チラシの掲載はありません。"
        : "掲載商品の情報がありません。"));
  }

  // 非表示中の商品を除外して区分ごとにグループ化
  const byCat = {};
  (store.products || []).forEach((p) => {
    if (isHidden(prodKey(store.id, p.name))) return;
    const cat = CATEGORY_ORDER.includes(p.category) ? p.category : "その他";
    (byCat[cat] = byCat[cat] || []).push(p);
  });

  // 表示区分: "全て"なら全区分、特定区分ならその区分のみ表示。
  const all = App.catFilter === "全て";
  CATEGORY_ORDER.forEach((cat) => {
    if (!all && App.catFilter !== cat) return;
    if (byCat[cat] && byCat[cat].length) card.appendChild(renderCategory(store, cat, byCat[cat], false));
  });
  // 「その他」は「全て」選択時のみ表示。
  if (all && byCat["その他"] && byCat["その他"].length) {
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

  // 産地 (国産/国外のみ、不明は空)
  const tdOrigin = el("td", "col-origin");
  if (p.origin === "国内") tdOrigin.innerHTML = `<span class="origin-tag origin-jp">国産</span>`;
  else if (p.origin === "国外") tdOrigin.innerHTML = `<span class="origin-tag origin-fr">国外</span>`;

  // 商品名(レシピリンク) + 連日なら期間バッジ("本日のみ"は非表示)
  const tdName = el("td", "col-name");
  const a = el("a", "prod-name", esc(p.name));
  a.addEventListener("click", (e) => { e.stopPropagation(); openRecipes(p); });
  tdName.appendChild(a);
  if (p.period && p.period !== "本日のみ") {
    tdName.appendChild(el("span", "period-badge", esc(p.period)));
  }

  // 価格 → 量(単位) の順 (値段と量を入れ替え)
  const tdPrice = el("td", "col-price", esc(p.price || ""));
  const tdUnit = el("td", "col-unit", esc(p.unit || ""));

  // 3日間非表示ボタン
  const tdHide = el("td", "col-hide");
  const hideBtn = el("button", "hide-btn", "3日間非表示");
  hideBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (App.selected[key]) { delete App.selected[key]; saveSelected(); }
    hideProduct(key);
    tr.remove();
  });
  tdHide.appendChild(hideBtn);

  // 行クリックで選択トグル(商品名リンク・非表示ボタンを除く)
  tr.addEventListener("click", () => toggleSelect(store, p, tr));

  tr.append(tdOrigin, tdName, tdPrice, tdUnit, tdHide);
  return tr;
}

function toggleSelect(store, p, tr) {
  const key = prodKey(store.id, p.name);
  if (App.selected[key]) {
    delete App.selected[key];
    tr.classList.remove("selected");
  } else {
    App.selected[key] = { store: store.name, name: p.name, unit: p.unit || "", price: p.price || "" };
    tr.classList.add("selected");
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
let _recipeCtx = null; // 現在開いているレシピ文脈

function findProductByName(name) {
  for (const s of App.data.stores || []) {
    const p = (s.products || []).find((pp) => pp.name === name);
    if (p) return p;
  }
  return null;
}

function openRecipes(p) {
  _recipeCtx = { product: p };
  document.querySelector(".recipe-controls").hidden = false;

  // プルダウンの選択肢: 野菜・鮮魚・肉の商品のみ。区分(野菜→鮮魚→肉)を第1ソートキーにする。
  const seen = new Set();
  const named = [];
  (App.data.stores || []).forEach((s) =>
    (s.products || []).forEach((pp) => {
      if (!RECIPE_CATS.includes(pp.category)) return;
      if (seen.has(pp.name)) return;
      seen.add(pp.name);
      named.push({ name: pp.name, cat: pp.category });
    })
  );
  // 区分を第1ソートキー(安定ソートなので同区分内は元の並び順を保持)
  named.sort((a, b) => RECIPE_CATS.indexOf(a.cat) - RECIPE_CATS.indexOf(b.cat));
  const allNames = named.map((x) => x.name);

  // 初期値: ①=クリックした商品、②=選択中(買い物リスト)の一番上(対象区分のもの)
  const firstSel = Object.values(App.selected).find((it) => allNames.includes(it.name));
  const sel2Default = firstSel ? firstSel.name : "";

  // 区分ごとに <optgroup> の区切り見出しを付けて表示する
  fillRecipeSelectGrouped($("recipeSel1"), named, p.name, false);
  fillRecipeSelectGrouped($("recipeSel2"), named, sel2Default, true);

  // プルダウン変更で即レシピを再検索・再表示する
  $("recipeSel1").onchange = renderRecipeList;
  $("recipeSel2").onchange = renderRecipeList;

  renderRecipeList();
  showModal("recipeModal");
}

// 区分(野菜/鮮魚/肉)ごとに <optgroup> の見出しで区切ってプルダウンを作る
function fillRecipeSelectGrouped(sel, named, selected, allowNone) {
  sel.innerHTML = "";
  if (allowNone) {
    const o = el("option", null, "（なし）");
    o.value = "";
    sel.appendChild(o);
  }
  // 選択商品が対象区分外(クリックした商品など)なら先頭に単独で足す
  if (selected && !named.some((x) => x.name === selected)) {
    const o = el("option", null, esc(selected));
    o.value = selected;
    sel.appendChild(o);
  }
  RECIPE_CATS.forEach((cat) => {
    const items = named.filter((x) => x.cat === cat);
    if (!items.length) return;
    const og = document.createElement("optgroup");
    og.label = cat; // 区分の区切り見出し
    items.forEach((x) => {
      const o = el("option", null, esc(x.name));
      o.value = x.name;
      og.appendChild(o);
    });
    sel.appendChild(og);
  });
  sel.value = selected || "";
}

// 商品名から料理名に出やすい「コア食材語」を取り出す。
// 例: 「豚バラうす切り」→「豚バラ」、「びんちょうまぐろ刺身用」→「びんちょうまぐろ」、
//     「銀だら切身(味付)」→「銀だら」。完全一致しなくても両方使い判定に使う。
function coreKeyword(name) {
  let k = String(name || "");
  k = k.replace(/[（(][^）)]*[）)]/g, ""); // 括弧内(スライス・焼肉用 等)を除去
  const strip = ["うす切り", "薄切り", "切り身", "切身", "刺身用", "刺身", "蒲焼",
    "生姜焼用", "焼肉用", "味付", "解凍", "冷凍", "ブロック", "スライス", "盛合せ"];
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of strip) {
      if (k.endsWith(s)) { k = k.slice(0, -s.length); changed = true; break; }
    }
  }
  k = k.replace(/[　\s]+/g, "").replace(/(特大|大|小|中)$/, "");
  return k.trim();
}

// レシピのタイトルが、その商品(完全名 or コア語)を使っているとみなせるか
function titleUsesProduct(title, name) {
  if (!title) return false;
  if (title.includes(name)) return true;
  const c = coreKeyword(name);
  return c.length >= 2 && title.includes(c);
}

// レシピカード1枚を組み立てる(extraTags があれば「◯◯ も使える」バッジを付ける)
function buildRecipeCard(r, extraTags) {
  const card = el("div", "recipe-card");
  if (extraTags && extraTags.length) card.classList.add("recipe-match");

  if (r.thumb) {
    const link = el("a", "rc-thumb");
    link.href = r.url;
    link.target = "_blank";
    link.rel = "noopener";
    const img = el("img");
    img.src = r.thumb;
    img.loading = "lazy";
    link.appendChild(img);
    card.appendChild(link);
  }

  if (extraTags && extraTags.length) {
    card.appendChild(el("div", "rc-match-tag", "🛒 " + extraTags.map(esc).join("・") + " も使える"));
  }

  const a = el("a", "rc-title", esc(r.title || "レシピ"));
  a.href = r.url;
  a.target = "_blank";
  a.rel = "noopener";
  card.appendChild(a);

  const send = el("button", "btn btn-line", "LINEへ送信");
  send.addEventListener("click", () => shareToLine(`🍳 ${r.title}\n${r.url}`));
  card.appendChild(send);
  return card;
}

function renderRecipeEmpty(name) {
  $("recipeNote").hidden = true;
  const q = encodeURIComponent(name);
  $("recipeBody").innerHTML =
    `<div class="recipe-empty">「${esc(name)}」の事前取得レシピがありません。<br>` +
    `<a href="https://recipe.rakuten.co.jp/search/${q}/" target="_blank" rel="noopener">楽天レシピで検索 ↗</a></div>`;
}

// ②未選択なら①のレシピ、②選択時は①と②の【両方を使う】レシピだけを表示する。
// (プルダウンを変えると即再検索。両方使いのレシピは楽天の複合キーワード検索でも辿れる)
function renderRecipeList() {
  const body = $("recipeBody");
  body.innerHTML = "";
  const note = $("recipeNote");

  const v1 = $("recipeSel1").value;
  const v2 = $("recipeSel2").value;
  const base1 = findProductByName(v1) || _recipeCtx.product;
  const name1 = v1 || base1.name;

  // --- ②未選択: ①のレシピをそのまま表示 ---
  if (!v2 || v2 === name1) {
    $("recipeTitle").textContent = `「${name1}」のレシピ`;
    const recipes = base1.recipes || [];
    if (!recipes.length) { renderRecipeEmpty(name1); return; }
    note.hidden = true;
    recipes.forEach((r) => body.appendChild(buildRecipeCard(r, [])));
    return;
  }

  // --- ②選択: ①と②の両方を使うレシピだけを表示 ---
  $("recipeTitle").textContent = `「${name1}」×「${v2}」のレシピ`;
  const base2 = findProductByName(v2);

  // ①・②双方の事前取得レシピを母集団にして重複排除
  const pool = [];
  const seen = new Set();
  [...(base1.recipes || []), ...(base2 && base2.recipes ? base2.recipes : [])].forEach((r) => {
    if (!seen.has(r.url)) { seen.add(r.url); pool.push(r); }
  });
  // 両方の商品(完全名 or コア食材語)をタイトルに含むレシピ=両方使いとみなす
  const both = pool.filter((r) =>
    titleUsesProduct(r.title, name1) && titleUsesProduct(r.title, v2)
  );

  // 楽天レシピの複数キーワード検索(本当の“両方使う”一覧への導線)
  const q = encodeURIComponent(`${name1} ${v2}`);
  const searchLink =
    `<a href="https://recipe.rakuten.co.jp/search/${q}/" target="_blank" rel="noopener">` +
    `楽天レシピで「${esc(name1)}×${esc(v2)}」をもっと見る ↗</a>`;

  if (both.length) {
    note.hidden = false;
    note.innerHTML = `🛒「${esc(name1)}」と「${esc(v2)}」の両方を使うレシピ ・ ${searchLink}`;
    both.forEach((r) => body.appendChild(buildRecipeCard(r, [])));
  } else {
    note.hidden = true;
    body.innerHTML =
      `<div class="recipe-empty">事前取得ぶんに「${esc(name1)}」と「${esc(v2)}」の両方を使うレシピは` +
      `見つかりませんでした。<br>${searchLink}</div>`;
  }
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
  updateSyncUI();
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
      onSettingsEdited(); // 削除も端末へ退避+GitHubへ自動反映
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
  onSettingsEdited(); // 追加を端末へ退避+GitHubへ自動反映(保存ボタンを押し忘れても届く)
  renderWatchList();
}

async function saveSettings() {
  App.settings.notify_time = $("notifyTime").value || "08:00";
  const token = $("ghToken").value.trim();
  if (token) { localStorage.setItem(LS.ghToken, token); syncFails = 0; }

  // GAS中継設定(端末ローカル保存)
  const gasUrl = $("gasUrl").value.trim();
  const gasSecret = $("gasSecret").value.trim();
  if (gasUrl) localStorage.setItem(LS.gasUrl, gasUrl); else localStorage.removeItem(LS.gasUrl);
  if (gasSecret) localStorage.setItem(LS.gasSecret, gasSecret); else localStorage.removeItem(LS.gasSecret);

  // 通知時刻+チェック商品は常に端末ローカルへ退避(PAT有無に関わらず消えない)
  saveSettingsLocal();

  const status = $("saveStatus");
  if (!localStorage.getItem(LS.ghToken)) {
    // ローカルには残るが、毎朝のLINE通知に反映するにはGitHub保存(PAT)が必要
    status.textContent = "この端末には保存しました。ただしLINE通知へ反映するには保存用トークン(PAT)が必要です。";
    updateSyncUI();
    return;
  }

  status.textContent = "保存中…";
  clearTimeout(syncTimer);
  await runSync();
  if (isSynced()) status.textContent = "✅ 保存しました（LINE通知にも反映）。反映まで数十秒かかることがあります。";
  else if (App.syncError) status.textContent = "❌ GitHub保存に失敗: " + App.syncError + "（この端末には保存済み）";
  else status.textContent = "反映中…";
}

async function commitSettings(token) {
  const path = "settings.json";
  const apiBase = `https://api.github.com/repos/${REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  const fetchSha = async () => {
    const cur = await fetch(apiBase, { headers, cache: "no-store" });
    return cur.ok ? (await cur.json()).sha : null;
  };

  // 送信内容はこの時点のスナップショット(送信中に編集されても混ざらない)
  const content = normSettings(App.settings);
  const put = (sha) => {
    const body = {
      message: `設定更新: 通知${content.notify_time} / チェック${content.watch_items.length}件`,
      content: b64utf8(JSON.stringify(content, null, 2) + "\n"),
    };
    if (sha) body.sha = sha;
    return fetch(apiBase, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  let res = await put(App.settingsSha || (await fetchSha()));
  if (res.status === 409 || res.status === 422) {
    // 別端末やバックエンドの更新でshaが古くなった → 取り直して1回だけ再試行
    res = await put(await fetchSha());
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t.slice(0, 120)}`);
  }
  App.settingsSha = (await res.json()).content.sha;
  App.remote = content;
  localStorage.setItem(LS.settingsBase, JSON.stringify(content));
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
  $("notifyTime").addEventListener("change", (e) => {
    App.settings.notify_time = e.target.value || "08:00";
    onSettingsEdited();
  });
  $("btnAddWatch").addEventListener("click", addWatchItem);
  $("watchInput").addEventListener("keydown", (e) => { if (e.key === "Enter") addWatchItem(); });
  $("btnCloseRecipe").addEventListener("click", () => hideModal("recipeModal"));
  $("btnCloseImage").addEventListener("click", () => hideModal("imageModal"));

  document.querySelectorAll(".modal").forEach((m) => {
    m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; });
  });
}

init();
