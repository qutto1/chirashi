/**
 * チラシまとめ Webアプリ用 LINE送信中継 (Google Apps Script)
 *
 * Webアプリの「LINEへ送信」から呼ばれ、毎朝の通知と同じ宛先(登録ユーザー)へ
 * LINE Messaging API の multicast でプッシュする。
 * チャネルトークン等の秘密は「プロジェクトの設定 > スクリプト プロパティ」に保存し、
 * 公開Webアプリには一切置かない。
 *
 * ── セットアップ手順 ──
 * 1. https://script.google.com/ で新規プロジェクトを作成し、このコードを貼り付け。
 * 2. 左の歯車「プロジェクトの設定」>「スクリプト プロパティ」に以下を追加:
 *      LINE_CHANNEL_TOKEN = (config.json と同じチャネルアクセストークン)
 *      LINE_USER_IDS      = U05f2fcb...,U801154b...   (カンマ区切り。通知先と同じ)
 *      SHARED_SECRET      = (任意の長いランダム文字列。Webアプリ設定にも同じ値を入れる)
 * 3.「デプロイ」>「新しいデプロイ」>「ウェブアプリ」:
 *      次のユーザーとして実行 = 自分
 *      アクセスできるユーザー = 全員
 *    デプロイして表示される「ウェブアプリのURL」をコピー。
 * 4. チラシまとめアプリの設定画面で、URLとSHARED_SECRETを貼り付けて保存。
 */

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents || "{}");
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty("SHARED_SECRET");

    if (secret && body.secret !== secret) {
      return jsonOut({ ok: false, error: "unauthorized" });
    }
    var text = (body.text || "").toString().slice(0, 4900);
    if (!text) return jsonOut({ ok: false, error: "empty text" });

    var token = props.getProperty("LINE_CHANNEL_TOKEN");
    var userIds = (props.getProperty("LINE_USER_IDS") || "")
      .split(",").map(function (s) { return s.trim(); }).filter(String);
    if (!token || !userIds.length) {
      return jsonOut({ ok: false, error: "not configured" });
    }

    var res = UrlFetchApp.fetch("https://api.line.me/v2/bot/message/multicast", {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: "Bearer " + token },
      payload: JSON.stringify({ to: userIds, messages: [{ type: "text", text: text }] }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    return jsonOut({ ok: code === 200, status: code });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut({ ok: true, service: "chirashi line relay" });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
