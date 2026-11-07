---
name: flapbase-site-migrate
description: 今のサイトを、Flapbase Site の部品で編集できる下書きに移す。HTML・React・Astro・WordPress の書き出しなど、元のコードと画像があるサイトの移行で使う。元の画面を描き、節を部品に当て、移せない所を人に返す。汎用の変換器や HTML のままの公開には使わない。
license: Apache-2.0
---

# 今のサイトを Flapbase Site に移す

変換するのはエージェント。元の文章・画像・節の構成を Site の部品に移し、公開前の下書きとして人に渡す。

## 元の頁と部品を読む

1. 文章と画像を移す権利を、人が確かめていることを確認する。対象の頁と、残したい内容・動きを整理する。
2. 元のコードを手元で開く。React・Astro などビルドが要るものは、そのサイトの手順でビルドする。各頁をスマホと PC で描き、画像を残す。見た目だけでなく、リンク・メニュー・フォームなどの動きも読む。
3. 頁ごとに、ヘッダー・FV・特徴・実績・料金・FAQ・問い合わせ・フッターなどの節に分け、順序・文章・画像・リンク先を控える。
4. `workspace_projects_list` で移行先を選ぶ。返った id を `projectId` に渡し、`site_catalog` で型・節・要素の部品、操作と変えられる項目を読む。人の画面だけで行う項目も確認する。
5. 「元の頁と節／Site の部品／文章・画像・リンクと変更項目／再現できない所」の対応表を作る。部品名と操作はカタログにあるものだけを使い、見た目を完全に再現できるとは約束しない。

## 下書きに移す

1. 新規なら `site_create` に `projectId`・`templateId`・`name`・操作ごとの UUID `idempotencyKey` を渡す。既存なら `site_get` に `projectId`・`artifactId` を渡す。以後は返った Site の id と版を使う。画像の送信にも `artifactId` が要るので、先に下書きを用意する。
2. 使う画像を `site_image_upload` で準備する。`projectId`・`artifactId` と、image に media・bytes・sha256 を渡す。PNG・JPEG・WebP、8MB まで、1辺 8192px・1600万画素まで。sha256 は sha256: と16進64字。upload.stored が false なら、返った upload.command に従い15分以内にファイルを PUT で送る。返った image（ref・digest・media）をそのまま操作に使う。
3. 対応表に沿って `site_apply` の operations と content を組む。`projectId`・`artifactId`・`expectedRevisionId` と操作ごとの UUID `idempotencyKey` を渡し、まず `check: true` で検査する。1回の operations は100件以内。エラーの操作番号・パス・理由を見て直す。
4. 検査が通ったら check を外し、同じ入力と `idempotencyKey` で保存する。次の変更には保存後の版を使う。版が衝突したら `site_get` で読み直し、他の変更を保って組み直す。リンクと頁の対応を残し、旧 URL の転送が必要ならカタログの content の項目で扱う。

## 元の画面と比べる

1. `site_render` に `projectId`・`artifactId` と保存した `revisionId` を渡す。返った HTML と実測スクリプトを手元のブラウザで実行する。各頁を元の画面と同じ幅で描き、節の順序・FV の構成・文章・画像・余白・リンクを比べる。
2. `site_compare` には同じ版と `referenceStructure`（sections は対応する節の部品名の配列、hero は FV の部品名）を渡す。この道具には Site に登録済みの参考画像が必要で、元の画像を直接渡す引数はない。参考画像がない場合のエラーは制約として記録し、手元で元の画像と比べる。登録済みでも元の画面の画像か確かめる。既定は構造の比較で、画素の比較をしたと報告しない。
3. 差があれば `site_apply` の検査・保存からやり直す。描画・比較・修正は各頁で最大3回。上限に達したら残る差を人に渡し、繰り返し続けない。
4. 最後に `site_check` で保存した版を点検する。静的検査だけでは実測済みにならない。手元のスクリプトでスマホと PC の文字サイズ・横のはみ出し・押せる大きさ・リンクを確かめる。使い終わったブラウザと自分が立てたサーバーは閉じる。

## 人に返す

- 下書きの id と版、対応表、比較した画像、検査結果と未確認の所を渡す。
- 当てはまらなかった JavaScript の動き・カルーセル・タブ・任意の HTML などと、移さなかった文章・画像・頁・フォームの処理・外部連携を一覧にする。代わりの部品で組んだ所と残る見た目の差も示す。
- 公開は `site_publish_request` に対象の `projectId`・`artifactId`・`expectedRevisionId` と新しい UUID `idempotencyKey` を渡して人に頼む。承認待ちであり、公開は人が Site の画面で決める。

## 守ること

- 任意の HTML や外部スクリプトを持ち込まない。Site にその節はない。埋め込みもカタログで認められた種類だけを使う。
- 秘密・個人情報・問い合わせの中身を、画像・本文・MCP の入力・記録に送らない。
- `site_render`・`site_compare`・`site_check` は既定では手元で描き、クレジットを使わない。手元で描けず `serverRender: true` が要る場合は、1呼び出し1クレジットとして予定回数と合計の見積りを先に人に示し、承認された範囲だけ実行する。画像生成など別のクレジットを使う道具も、先に見積りを人に見せる。入力定義にない同意の引数は足さない。
