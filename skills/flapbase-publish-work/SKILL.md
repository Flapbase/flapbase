---
name: flapbase-publish-work
description: Flapbase の Site と Design の道具で制作物を作り、確かめ、公開を人に頼む。サイトの下書き、告知の画像、手元での描画の確かめ、クレジットの見積りが出る場面で使う。
license: Apache-2.0
---

# 制作物を出す

作るのはエージェント、公開するのは人。道具は下書きか新しい版を保存するだけで、公開しない。

## Site

1. `site_reference_guide` と `site_catalog` で、使える型・節・部品を読む。
2. `site_create` で下書きを作る。WordPress や公開中のサイトからは `site_import_inspect` で読み、`site_import` で材料にする（文章と画像を移す権利は人が画面で確かめる）。
3. 参考画像が要るなら `site_reference_generate`。最初は見積りが返るので、人に金額と文を承認してもらい、`creditConsent` を付けて同じ入力で送り直す。選ばれた画像は `site_reference_set` で記録する。
4. 直しは `site_apply`。`check: true` で確かめてから、外して同じ入力で保存する。手元の画像は `site_image_upload` で上げる。
5. `site_get` で保存した版を読む。

## Design

1. `design.catalog.list` で、レシピ・大きさ・配色を読む。
2. `design_preview` で案を受け取る。呼ぶたびにクレジットを使うので、呼ぶ前に依頼主に確かめる。使う案は人が選ぶ。
3. `design_save` で下書きを保存し、`design_get` で読み、`design_check` で無料の点検をして、`design_apply` で直す。直した版は `design_save` で足す。

## 描画は手元、こちらで描くならクレジット

- `site_render`・`site_compare`・`site_check`・`design_render` は、描くための HTML と実測のスクリプトを返す。既定は、エージェントの手元のブラウザ（Playwright など）で開いて描き、確かめる。
- 手元で描けないときだけ `serverRender: true` を付ける。こちらで描き、1回の呼び出しにつき1クレジットを使う。付ける前に依頼主に確かめる。

## 確かめを頼む

- 手元で PC とスマホの両方を描き、文字の大きさ・はみ出し・押せる大きさを見てから、人に見せる。
- 公開は `site_publish_request` で人に頼む。承認待ちが返るだけで、公開はしない。人が Site の画面で確かめて公開する。Design の書き出しも人が画面で行う。

## 守ること

- 参考にした他人の制作物の見た目をそのまま写さない。
- 画像は、使ってよいと人が確かめたものだけを使う。
