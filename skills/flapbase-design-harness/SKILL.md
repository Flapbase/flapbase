---
name: flapbase-design-harness
description: Flapbase のデザインハーネスで Web のページや画面を組み、ブラウザで実測して検査する。余白・文字・角丸・線・色の役割・フォーカスの決まりと、お知らせ・入力・レポート・対応方法などの型、しないことの一覧、貼って流す検査の script を持つ。外の AI だけで使える。何も送らない。
license: Apache-2.0
business-categories: ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14"]
transaction-types: ["なし"]
---

# デザインハーネスでページを組み、検査する

## 用意するもの

依頼主から、次のどちらかを受け取って始める。

- 組む：作りたいページや画面の目的と中身（題・説明・入力・結果・次の行為）
- 検査する：確かめたいページの URL か、HTML と CSS

Flapbase への登録や MCP の接続は要らない。検査の script はページの中だけを測り、どこにも送らない。

## 始める前に

前の検査の結果があれば、規則ごとの件数と比べる。ページがすでにあるなら、組み直す前に下の検査を 375px と 1280px で流し、違反の一覧を今の状態として残す。ブラウザを動かせない AI は、依頼主に script を開発者ツールのコンソールで流してもらい、返った結果の貼り付けを受けて読む。

## 手順

### 原則

ガチガチに縛るのでなく、標準を作る。標準から外れた所は、下の検査が「見直す」として知らせる。

- 色は直書きしない。色の役割の変数を使う
- 同じ種類のページは個々に組まず、標準のテンプレートに中身を渡して作る
- 同じ働きの部品は個々に作らず、標準の部品を使う
- 標準で足りない時は、そのページで作り込まずに、標準の部品・テンプレート・値を足す
- 標準から外れる時は理由を残す。検査の「見直す」はその知らせ

### 決まり（値）

ここにない値は使わない。

| 項目 | 値 |
| --- | --- |
| 余白の段 | 4・8・12・16・24・32・48・64px（64 は広い場所とアイコンのボタンの逃げだけ） |
| 文字の段 | 12・14・16・17・22・32・40px（本文 16、補足 14、付記 12。12 未満にしない） |
| 角丸 | 4px だけ（信号の丸の 50% だけが例外） |
| 線 | 1px solid（強調だけ 2px） |
| 影 | なし |
| フォーカス | 輪も影も出さず、1px solid の線の色だけを #0d7877 に替える |
| ボタンと入力欄の高さ | 44px |
| ページの幅 | 本文 840px、左右 16px（600px 以上は 24px）、セクションの上下 32px（768px 以上は 48px） |
| 動き | 150ms 以下 |
| コントラスト | 4.5 以上（24px 以上か太字の 18.66px 以上は 3） |

| 色の役割 | 値 | 使う所 |
| --- | --- | --- |
| bg.page | #ffffff | ページの背景 |
| text.primary | #1f2933 | 本文 |
| text.secondary | #6b7785 | 補足文 |
| border.subtle | #e3e8ec | 区切りの線 |
| border.strong | #1f2933 | 強い線・入力欄の線 |
| action.primary.bg | #0d7877 | 主のボタン |
| action.primary.fg | #ffffff | 主のボタンの文字 |
| border.focus | #0d7877 | フォーカスの線 |
| signal.ok | #12b76a | 信号：あり |
| signal.warn | #f79009 | 信号：要確認 |
| signal.bad | #f04438 | 信号：なし |

| 文字 | 大きさ | 行の高さ | 太さ |
| --- | --- | --- | --- |
| 題（h1、768px 以上） | 40px | 1.4 | 700 |
| 題（h1） | 32px | 1.4 | 700 |
| 見出し（h2） | 22px | 1.5 | 700 |
| 小見出し（h3） | 17px | 1.6 | 700 |
| 本文・入力欄 | 16px | 1.85 | 400 |
| 補足・表・値・ボタン（ボタンは 700） | 14px | 1.7 | 400 |
| 付記 | 12px | 1.7 | 400 |

### 型

ページは上から、題とお知らせ、入力、レポート、対応方法の順に、同じ幅のセクションを積む。セクションの間は 1px の線で区切り、面で囲まない。

#### ページの枠（tp-page）

ページ全体。値の変数を持ち、背景はページの背景の白。

1. header（ロゴと右に「ログイン」「無料で始める」）
2. main.tp-page
3. section.tp-section を上から積む
4. footer

- セクションは同じ幅・同じ左端。内側は div.tp-wrap 1種類だけ
- 本文の幅 840px、左右の余白 16px（600px 以上は 24px）
- セクションの上下 32px（768px 以上は 48px）、セクションの間は 1px の線
- 背景の面で囲まない。区切りは線

#### 見出しと本文（tp-title / tp-h2 / tp-h3 / tp-text / tp-note）

題・見出し・小見出し・本文・補足。

1. h1.tp-title（下 24）
2. h2.tp-h2（下 16）
3. h3.tp-h3（下 8）
4. p.tp-text（下 16）
5. p.tp-note（補足 14px）

- 段落と部品の間 16、まとまりの間 24
- 見出しの字間を詰めない
- 同じ意味を2か所に書かない

#### お知らせ（tp-notice）

ページの題のすぐ下に、今知ってほしい事実を1つ。

1. 上下の 1px の線
2. 「お知らせ」の札（tp-tag）と日付
3. 本文 16px
4. 出典の一覧（tp-links、リンクの高さ 44px）

- 片側だけ色の太い線にしない
- 札は 1px の線と 4px の角丸、塗らない

#### 入力（tp-form）

入力欄とボタンで、1つの行為を始める。

1. ラベル（14px・700）
2. 入力欄（高さ 44px）
3. ボタン（入力欄のすぐ右、間 8px）

- ボタンと入力欄は同じ高さ 44px で上下をそろえる
- 768px 未満は縦に積み、ボタンは横いっぱい
- 主のボタンは1つ

#### ボタン（tp-button / tp-button-primary / tp-button-secondary）

行為を1つ起こす。

1. 字は行為を書く（「無料で確かめる」）

- 高さ 44px、角丸 4px、字 14px・700
- 主はブランドの色の塗り、副は白地＋線
- 1つのまとまりに主は1つ
- 押せない時は 50% の薄さ。押せない理由の文は出さない

#### アイコンのボタン（tp-icon-button）

コピーなど、字のいらない行為。

1. 44px 角の枠に絵を1つ

- aria-label と title に行為の語（「コピー」）
- 押したら絵を 2 秒間チェックに替える
- 線 1px、角丸 4px

#### レポート（tp-report）

結果と記録だけを置く。行動の提案は置かない。

1. 上に 2px の線
2. 対象と確認日時
3. 要約（名前・信号・判定の語、横 3 つ）
4. 詳細の表（項目・見たこと・判定。560px 未満は縦の並び）
5. 参考の1行
6. 付記
7. 結果を残す行

- 要約の枠は 1px の線、面で塗らない
- 表の行は 1px の線で区切る

#### 信号（tp-dot tp-tone-ok / tp-tone-warn / tp-tone-bad）

判定を色と語で示す。

1. 0.6em の丸
2. 判定の語（あり／要確認／なし）

- 色だけで伝えない。丸の隣に必ず語
- 緑 #12b76a・オレンジ #f79009・赤 #f04438 だけ
- 丸だけが角丸 50% の例外

#### 対応方法（tp-paths / tp-path）

結果を受けてできることを、上下に積んで並べる。

1. 見出し「対応方法」
2. tp-path を上下に積む：小見出し・一文・中身・ボタンかリンク
3. 結果で値が決まる項目は先頭に条件付きで

- それぞれ線で区切った同じ型
- 最初の項目の上は 2px の線
- 貼る文の枠は右上にコピーのアイコンのボタン

#### 付記（tp-terms）

用語の説明。閉じた details。

1. summary「用語の説明」（高さ 44px）
2. dl（dt 太字・dd 12px）

- 12px、補足文の色
- レポートの中、結果を残す行の前

#### 結果を残す行（tp-keep）

結果が出た時だけ、レポートの最後に細い1行。

1. 左に「この結果を残す」
2. 右にログインのボタン
3. 右端に閉じる ×
4. 下に小さく同意の一文

- 結果が出る前は出さない
- 浮かせない（position:fixed にしない）、影を付けない

#### 上の帯のボタン（header の「ログイン」「無料で始める」）

ページの上の帯の右端。

1. 「ログイン」（副）
2. 「無料で始める」（主）

- 同じ高さ 44px・同じ角丸 4px・同じ太さ 600

#### フォーカス（（全部の押せる物と入力欄））

今どこにいるかを示す。

1. 1px solid の線の色だけをフォーカスの色に替える

- 輪（outline）も影（box-shadow）も出さない
- 線のない物（リンク）は下線の色を替える

### しないこと・すること

| しない | する | 理由 | 規則 |
| --- | --- | --- | --- |
| 純黒 #000 の文字 | 本文の色 #1f2933 | 黒は強すぎて長く読むと疲れる | color-role |
| 補足を薄い灰色（#9aa4ae など）にする | 補足文の色 #6b7785 | 白地とのコントラストが 4.5 を下回ると読めない | contrast |
| カードに影を付ける・薄い色の面で囲む | 1px solid の線で区切る | 影と面は飾りになり、まとまりの境が曖昧になる | surface |
| 角丸なしと大きい角丸を混ぜる | 角丸は 4px だけ | 形がそろわないとページが寄せ集めに見える | radius |
| 色だけで状態を伝える | 信号の丸の隣に「あり」「要確認」「なし」 | 色の見え方は人によって違う | signal-label |
| 片側だけ色の太い線を引いたお知らせ | 上下の 1px の線と「お知らせ」の札 | AI が作った画面に多い飾りで、強調が強すぎる | border |
| フォーカスに輪や影を出す | 1px solid の線の色だけを替える | 輪は形を崩し、周りと重なる | focus |
| 見出しの字間を詰める | 字間は既定のまま | 日本語は詰めると読みにくい | tracking |
| 暗い背景の帯やサイドバー | 白地と線 | 暗い面は本文より目を引き、主が分からなくなる | surface |
| 1つのまとまりに主のボタンを2つ以上 | 主は1つ、ほかは白地＋線 | どれを押せばよいか迷う | primary-one |
| ボタンを入力欄より低くする | どちらも高さ 44px で上下をそろえる | 指で押しにくく、並びがずれる | control-h |
| 300ms 以上かかる動き | 150ms 以下 | 操作が鈍く感じる | motion |
| 画面の右上に浮かぶ箱（position:fixed）で案内する | ページの中の決まった場所に1行で置く | 本文を隠し、閉じる操作を増やす | surface |
| 12px 未満の文字 | 本文 16px、補足 14px、付記 12px | スマホで読めない | type-floor |
| CSS や style に #0d7877 のような色を直書きする | 色の役割の変数（--fh-action-bg など）を使う | 色を変える時に直し漏れが出る | color-literal |
| ページごとにボタンやお知らせを作る | 標準の部品を使う | 同じ物が少しずつ違って見える | component |
| 似たページを1枚ずつ組む | 標準のテンプレートに中身を渡す | 余白・順・幅がページごとにずれる | template |

### 標準の CSS

ページに次の CSS をそのまま入れる。色・余白・文字は --fh- の変数だけを使い、直書きしない。

```css
/* src/tokens.ts から scripts/generate.ts が作る。直接は直さない。 */
:root{
  --fh-space-4:4px;
  --fh-space-8:8px;
  --fh-space-12:12px;
  --fh-space-16:16px;
  --fh-space-24:24px;
  --fh-space-32:32px;
  --fh-space-48:48px;
  --fh-space-64:64px;
  --fh-type-fine:12px;
  --fh-type-note:14px;
  --fh-type-body:16px;
  --fh-type-h3:17px;
  --fh-type-h2:22px;
  --fh-type-title:32px;
  --fh-type-title-wide:40px;
  --fh-radius:4px;
  --fh-bg-page:#ffffff;
  --fh-text-primary:#1f2933;
  --fh-text-secondary:#6b7785;
  --fh-border-subtle:#e3e8ec;
  --fh-border-strong:#1f2933;
  --fh-action-bg:#0d7877;
  --fh-action-fg:#ffffff;
  --fh-border-focus:#0d7877;
  --fh-signal-ok:#12b76a;
  --fh-signal-warn:#f79009;
  --fh-signal-bad:#f04438;
  --fh-control-h:44px;
  --fh-wrap:840px;
  --fh-gutter-narrow:16px;
  --fh-gutter-wide:24px;
  --fh-section-y-narrow:32px;
  --fh-section-y-wide:48px;
  --fh-motion:150ms;
}
/* 公開ページの型（/tools/* ほか）。値は css/tokens.css の --fh-*（src/tokens.ts から生成）だけを使う。
   型の説明は src/patterns.ts、検査は src/engine.js。数値を直接書かない（0・1px・2px・50%・44px を除く）。 */
.tp-page{color:var(--fh-text-primary);background:var(--fh-bg-page);--fh-gutter:var(--fh-gutter-narrow);--fh-section-y:var(--fh-section-y-narrow);--fh-title:var(--fh-type-title)}
@media (min-width:600px){.tp-page{--fh-gutter:var(--fh-gutter-wide)}}
@media (min-width:768px){.tp-page{--fh-section-y:var(--fh-section-y-wide);--fh-title:var(--fh-type-title-wide)}}
.tp-page [hidden]{display:none!important}
.tp-page :is(a,button,input,select,textarea,summary):focus,.tp-page :is(a,button,input,select,textarea,summary):focus-visible{outline:none;box-shadow:none}
.tp-page .tp-section{padding:var(--fh-section-y) 0;background:var(--fh-bg-page)}
.tp-page .tp-section+.tp-section{border-top:1px solid var(--fh-border-subtle)}
.tp-page .tp-wrap{width:min(var(--fh-wrap),100% - 2*var(--fh-gutter));margin:0 auto}
.tp-page .tp-title{margin:0 0 var(--fh-space-24);font-size:var(--fh-title);line-height:1.4;font-weight:700}
.tp-page .tp-h2{margin:0 0 var(--fh-space-16);font-size:var(--fh-type-h2);line-height:1.5;font-weight:700}
.tp-page .tp-h3{margin:0 0 var(--fh-space-8);font-size:var(--fh-type-h3);line-height:1.6;font-weight:700}
.tp-page .tp-text{margin:0 0 var(--fh-space-16);font-size:var(--fh-type-body);line-height:1.85}
.tp-page .tp-note{margin:0 0 var(--fh-space-16);font-size:var(--fh-type-note);line-height:1.7;color:var(--fh-text-secondary);overflow-wrap:anywhere}
.tp-page :is(.tp-text,.tp-note):last-child{margin-bottom:0}
.tp-page .tp-note a,.tp-page .tp-links a{color:var(--fh-text-primary);text-decoration:underline;text-decoration-color:var(--fh-border-strong)}
.tp-page .tp-note a:focus-visible,.tp-page .tp-links a:focus-visible{text-decoration-color:var(--fh-border-focus)}
.tp-page .tp-value{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:var(--fh-type-note);line-height:1.7;overflow-wrap:anywhere}
/* ボタン・入力欄：高さ 44px、角丸 4px、フォーカスは線の色だけ */
.tp-page .tp-button{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:var(--fh-control-h);padding:0 var(--fh-space-24);font:inherit;font-size:var(--fh-type-note);font-weight:700;line-height:1;color:var(--fh-text-primary);background:var(--fh-bg-page);border:1px solid var(--fh-border-strong);border-radius:var(--fh-radius);text-decoration:none;cursor:pointer;transition:border-color var(--fh-motion)}
.tp-page .tp-button-primary{color:var(--fh-action-fg);background:var(--fh-action-bg);border-color:var(--fh-action-bg)}
.tp-page .tp-button[disabled]{opacity:.5;cursor:default}
.tp-page :is(.tp-button,.tp-icon-button,.tp-field input):focus-visible{border-color:var(--fh-border-focus)}
.tp-page .tp-button.tp-button-primary:focus-visible{border-color:var(--fh-text-primary)}
.tp-page .tp-icon-button{display:inline-flex;align-items:center;justify-content:center;flex:none;box-sizing:border-box;width:var(--fh-control-h);height:var(--fh-control-h);padding:0;color:var(--fh-text-primary);background:var(--fh-bg-page);border:1px solid var(--fh-border-subtle);border-radius:var(--fh-radius);cursor:pointer;transition:border-color var(--fh-motion)}
.tp-page .tp-form{display:grid;gap:var(--fh-space-8);margin:0 0 var(--fh-space-12)}
.tp-page .tp-field{display:grid;gap:var(--fh-space-8)}
.tp-page .tp-field label{font-size:var(--fh-type-note);font-weight:700}
.tp-page .tp-field input{box-sizing:border-box;width:100%;height:var(--fh-control-h);padding:0 var(--fh-space-16);font:inherit;font-size:var(--fh-type-body);color:var(--fh-text-primary);background:var(--fh-bg-page);border:1px solid var(--fh-border-strong);border-radius:var(--fh-radius);transition:border-color var(--fh-motion)}
.tp-page .tp-form .tp-button{width:100%}
@media (min-width:768px){.tp-page .tp-form{grid-template-columns:minmax(0,1fr) auto;align-items:end}.tp-page .tp-form .tp-button{width:auto}}
/* 欄が2つ以上の入力は縦に積む。textarea・チェック・色・ファイル・人に見えない欄 */
.tp-page .tp-form-stack{grid-template-columns:minmax(0,1fr)!important;gap:var(--fh-space-16)}
.tp-page .tp-form-stack .tp-button{width:auto;justify-self:start}
.tp-page .tp-field .tp-note{margin:0}
.tp-page .tp-field{--platform-input-max:none;--platform-input-max-wide:none}
.tp-page .tp-field :is(input,textarea,select){max-width:none}
.tp-page .tp-wrap>.tp-h3:not(:first-child){margin-top:var(--fh-space-24)}
.tp-page .tp-field textarea{box-sizing:border-box;width:100%;min-height:calc(var(--fh-control-h) * 3);padding:var(--fh-space-12) var(--fh-space-16);font:inherit;font-size:var(--fh-type-body);line-height:1.85;color:var(--fh-text-primary);background:var(--fh-bg-page);border:1px solid var(--fh-border-strong);border-radius:var(--fh-radius);resize:vertical;transition:border-color var(--fh-motion)}
.tp-page .tp-field :is(input[type=email],input[type=url]){box-sizing:border-box;width:100%;height:var(--fh-control-h);padding:0 var(--fh-space-16);font:inherit;font-size:var(--fh-type-body);color:var(--fh-text-primary);background:var(--fh-bg-page);border:1px solid var(--fh-border-strong);border-radius:var(--fh-radius);transition:border-color var(--fh-motion)}
.tp-page .tp-field :is(textarea,input[type=email],input[type=url]):focus-visible{border-color:var(--fh-border-focus)}
.tp-page .tp-field-color input[type=color]{box-sizing:border-box;width:var(--fh-control-h);height:var(--fh-control-h);padding:var(--fh-space-4);background:var(--fh-bg-page);border:1px solid var(--fh-border-strong);border-radius:var(--fh-radius)}
.tp-page .tp-field input[type=file]{min-height:var(--fh-control-h);font:inherit;font-size:var(--fh-type-note)}
.tp-page .tp-field-row{display:grid;gap:var(--fh-space-16)}
@media (min-width:768px){.tp-page .tp-field-row{grid-template-columns:repeat(2,minmax(0,1fr))}}
.tp-page .tp-check{display:flex;align-items:flex-start;gap:var(--fh-space-8);min-height:var(--fh-control-h);font-size:var(--fh-type-note);line-height:1.7}
.tp-page .tp-check input{flex:none;width:var(--fh-space-16);height:var(--fh-space-16);margin:var(--fh-space-4) 0 0;accent-color:var(--fh-action-bg)}
.tp-page .tp-trap{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
/* 手順・用語・項目の一覧・まとまり */
.tp-page .tp-steps{margin:0 0 var(--fh-space-16);padding:0 0 0 var(--fh-space-24);font-size:var(--fh-type-body);line-height:1.85}
.tp-page .tp-steps li+li{margin-top:var(--fh-space-4)}
.tp-page .tp-defs{margin:0}
.tp-page .tp-defs dt{margin:var(--fh-space-16) 0 0;font-size:var(--fh-type-body);font-weight:700}
.tp-page .tp-defs dt:first-child{margin-top:0}
.tp-page .tp-defs dd{margin:var(--fh-space-4) 0 0;font-size:var(--fh-type-note);line-height:1.7;color:var(--fh-text-secondary)}
.tp-page .tp-items{list-style:none;margin:0;padding:0}
.tp-page .tp-item{padding:var(--fh-space-16) 0;border-top:1px solid var(--fh-border-subtle)}
.tp-page .tp-item:last-child{border-bottom:1px solid var(--fh-border-subtle)}
.tp-page .tp-item .tp-note{margin-bottom:var(--fh-space-8)}
.tp-page .tp-item .tp-h3 a{color:var(--fh-text-primary);text-decoration:underline;text-decoration-color:var(--fh-border-strong);text-underline-offset:var(--fh-space-4)}
.tp-page .tp-item .tp-h3 a:focus-visible{text-decoration-color:var(--fh-border-focus)}
.tp-page .tp-group{margin:0 0 var(--fh-space-16)}
.tp-page .tp-group:last-child{margin-bottom:0}
/* お知らせ */
.tp-page .tp-notice{margin:0 0 var(--fh-space-24);padding:var(--fh-space-16) 0;border-top:1px solid var(--fh-border-subtle);border-bottom:1px solid var(--fh-border-subtle)}
.tp-page .tp-notice-head{display:flex;align-items:center;gap:var(--fh-space-12);margin:0 0 var(--fh-space-8);font-size:var(--fh-type-note);color:var(--fh-text-secondary)}
.tp-page .tp-tag{padding:var(--fh-space-4) var(--fh-space-8);border:1px solid var(--fh-border-strong);border-radius:var(--fh-radius);font-weight:700;color:var(--fh-text-primary)}
.tp-page .tp-links{list-style:none;margin:var(--fh-space-12) 0 0;padding:0;display:grid;gap:var(--fh-space-4)}
.tp-page .tp-links a{display:inline-flex;align-items:center;min-height:var(--fh-control-h);font-size:var(--fh-type-note);line-height:1.6;overflow-wrap:anywhere}
/* レポート */
.tp-page .tp-report{border-top:2px solid var(--fh-border-strong);padding-top:var(--fh-space-16)}
.tp-page .tp-report-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--fh-space-4) var(--fh-space-16);padding-bottom:var(--fh-space-12);border-bottom:1px solid var(--fh-border-subtle)}
.tp-page .tp-report-head p{margin:0;font-size:var(--fh-type-note);line-height:1.7;color:var(--fh-text-secondary)}
.tp-page .tp-sum{list-style:none;margin:var(--fh-space-16) 0 0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--fh-space-8)}
.tp-page .tp-sum li{display:grid;gap:var(--fh-space-4);margin:0;padding:var(--fh-space-12) var(--fh-space-16);border:1px solid var(--fh-border-subtle)}
.tp-page .tp-sum-name{font-size:var(--fh-type-note);font-weight:700;color:var(--fh-text-secondary)}
.tp-page .tp-sum-verdict{font-size:var(--fh-type-body);font-weight:700}
.tp-page .tp-table{width:100%;table-layout:fixed;border-collapse:collapse;margin:var(--fh-space-16) 0 0;font-size:var(--fh-type-note);line-height:1.7}
.tp-page .tp-table :is(th,td){padding:var(--fh-space-12) var(--fh-space-8);text-align:left;vertical-align:top;border-bottom:1px solid var(--fh-border-subtle);overflow-wrap:anywhere}
.tp-page .tp-table thead th{font-weight:700;color:var(--fh-text-secondary)}
.tp-page .tp-report-head strong{font-size:var(--fh-type-body);color:var(--fh-text-primary);overflow-wrap:anywhere}
.tp-page .tp-report>.tp-text:only-child{margin:0}
.tp-page .tp-report>:is(.tp-text,.tp-note):not(:first-child){margin-top:var(--fh-space-16)}
.tp-page :is(.tp-seen,.tp-pre){white-space:pre-wrap}
.tp-page .tp-path .tp-table{margin-top:0}
.tp-page .tp-setup-table th:nth-child(1){width:4.5em}.tp-page .tp-setup-table th:nth-child(2){width:7em}
.tp-page .tp-setup-table td:last-child{display:flex;align-items:center;justify-content:space-between;gap:var(--fh-space-8)}
/* 信号：丸（角丸 50% の例外）と語を並べる */
.tp-page .tp-signal{display:inline-flex;align-items:center}
.tp-page .tp-dot{display:inline-block;flex:none;width:.6em;height:.6em;margin-right:var(--fh-space-8);border-radius:50%;background:var(--fh-text-secondary)}
.tp-page .tp-dot.tp-tone-ok{background:var(--fh-signal-ok)}.tp-page .tp-dot.tp-tone-warn{background:var(--fh-signal-warn)}.tp-page .tp-dot.tp-tone-bad{background:var(--fh-signal-bad)}
/* 付記 */
.tp-page .tp-terms{margin-top:var(--fh-space-24);font-size:var(--fh-type-fine);line-height:1.7;color:var(--fh-text-secondary)}
.tp-page .tp-terms summary{display:flex;align-items:center;min-height:var(--fh-control-h);cursor:pointer}
.tp-page .tp-terms dl{margin:0 0 var(--fh-space-8)}.tp-page .tp-terms dt{margin-top:var(--fh-space-8);font-weight:700}.tp-page .tp-terms dd{margin:0}
/* 結果を残す行 */
.tp-page .tp-keep{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--fh-space-8) var(--fh-space-16);margin-top:var(--fh-space-24);padding-top:var(--fh-space-16);border-top:1px solid var(--fh-border-subtle);font-size:var(--fh-type-note)}
.tp-page .tp-keep small{flex-basis:100%;font-size:var(--fh-type-fine);color:var(--fh-text-secondary)}
/* 対応方法：上下に積む */
.tp-page .tp-paths{display:grid}
.tp-page .tp-path{min-width:0;padding:var(--fh-space-24) 0;border-top:1px solid var(--fh-border-subtle)}
.tp-page .tp-path:first-child,.tp-page .tp-path[hidden]+.tp-path{border-top:2px solid var(--fh-border-strong)}
.tp-page .tp-prompt-wrap{position:relative;margin:0 0 var(--fh-space-12)}
.tp-page .tp-prompt{margin:0;padding:var(--fh-space-16) var(--fh-space-64) var(--fh-space-16) var(--fh-space-16);font-size:var(--fh-type-body);line-height:1.85;border:1px solid var(--fh-border-subtle);border-radius:var(--fh-radius);white-space:pre-line;overflow-wrap:anywhere}
.tp-page .tp-prompt-wrap .tp-icon-button{position:absolute;top:var(--fh-space-8);right:var(--fh-space-8)}
@media (max-width:559px){
  .tp-page .tp-sum{gap:var(--fh-space-4)}.tp-page .tp-sum li{padding:var(--fh-space-12) var(--fh-space-8)}.tp-page .tp-sum-verdict{font-size:var(--fh-type-note)}
  .tp-page .tp-table:not(.tp-setup-table) thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .tp-page .tp-table:not(.tp-setup-table) :is(tbody,tr,th,td){display:block;width:auto!important}
  .tp-page .tp-table:not(.tp-setup-table) tr{padding:var(--fh-space-8) 0;border-bottom:1px solid var(--fh-border-subtle)}
  .tp-page .tp-table:not(.tp-setup-table) :is(th,td){border:0;padding:var(--fh-space-4) 0}
  .tp-page .tp-table:not(.tp-setup-table) td[data-label]::before{content:attr(data-label) "　";font-size:var(--fh-type-fine);color:var(--fh-text-secondary)}
}
```

### 標準のテンプレートと部品

無料の道具・診断のページは、次の HTML の形をそのまま使い、字と中身だけを替える。部品の根の data-harness-component と、ページの根の data-harness-template は消さない。部品を足す時は、この中の同じ部品の形を写す。

```html
<div class="tp-page" data-harness-template="tool-page@1">
<section class="tp-section tp-hero" aria-labelledby="sample-title" data-harness-component="section">
<div class="tp-wrap">
<h1 id="sample-title" class="tp-title" data-harness-component="title">メールの届きやすさを確かめる</h1>
<aside aria-label="お知らせ" class="tp-notice" data-harness-component="notice">
<p class="tp-notice-head">
<span class="tp-tag">お知らせ</span>
<time datetime="2026-11">2026年11月</time>
</p>
<p class="tp-text" data-harness-component="text">2026年11月から、DMARC の設定がないと一部の受信先でメールが拒否されるおそれがあります。</p>
<ul class="tp-links">
<li>
<a href="https://example.com/">受信側の発表（英語）</a>
</li>
</ul>
</aside>
<p class="tp-note" data-harness-component="note">公開の設定だけを読みます。何も送りません。</p>
<form class="tp-form" data-harness-component="form">
<div class="tp-field" data-harness-component="field">
<label for="sample-domain">ドメインを入れる</label>
<input type="text" autocomplete="off" id="sample-domain" placeholder="example.com">
</div>
<button type="submit" class="tp-button tp-button-primary" data-harness-component="button">無料で確かめる</button>
</form>
<p role="status" aria-live="polite" class="tp-note" data-harness-component="note">
</p>
</div>
</section>
<section aria-labelledby="sample-section-1" class="tp-section" data-harness-component="section">
<div class="tp-wrap">
<h2 id="sample-section-1" class="tp-h2" data-harness-component="heading">診断の結果</h2>
<div class="tp-report" data-harness-component="report">
<div class="tp-report-head">
<p class="tp-domain">
<strong>example.com</strong>
</p>
<p>2026年11月9日 確認</p>
</div>
<ul class="tp-sum" data-harness-component="summary">
<li>
<span class="tp-sum-name">SPF</span>
<span class="tp-sum-verdict">
<span class="tp-signal" data-harness-component="signal">
<span class="tp-dot tp-tone-ok" aria-hidden="true">
</span>あり</span>
</span>
</li>
<li>
<span class="tp-sum-name">DKIM</span>
<span class="tp-sum-verdict">
<span class="tp-signal" data-harness-component="signal">
<span class="tp-dot tp-tone-warn" aria-hidden="true">
</span>要確認</span>
</span>
</li>
<li>
<span class="tp-sum-name">DMARC</span>
<span class="tp-sum-verdict">
<span class="tp-signal" data-harness-component="signal">
<span class="tp-dot tp-tone-bad" aria-hidden="true">
</span>なし</span>
</span>
</li>
</ul>
<table class="tp-table" data-harness-component="table">
<thead>
<tr>
<th scope="col">項目</th>
<th scope="col">見たこと</th>
<th scope="col">判定</th>
</tr>
</thead>
<tbody>
<tr>
<th scope="row">SPF</th>
<td data-label="見たこと">
<span class="tp-value">v=spf1 include:_spf.google.com ~all</span>
</td>
<td data-label="判定">
<span class="tp-signal" data-harness-component="signal">
<span class="tp-dot tp-tone-ok" aria-hidden="true">
</span>あり</span>
</td>
</tr>
<tr>
<th scope="row">DMARC</th>
<td data-label="見たこと">設定なし</td>
<td data-label="判定">
<span class="tp-signal" data-harness-component="signal">
<span class="tp-dot tp-tone-bad" aria-hidden="true">
</span>なし</span>
</td>
</tr>
</tbody>
</table>
<details class="tp-terms" data-harness-component="terms">
<summary>用語の説明</summary>
<dl>
<dt>DMARC</dt>
<dd>SPF・DKIM の結果をどう扱うかを、受け取る側に示す方針。</dd>
</dl>
</details>
<div class="tp-keep" data-harness-component="keep-row">
<span>この結果を残す</span>
<button type="button" class="tp-button" data-harness-component="button">Google で続ける</button>
<small>続けると利用規約とプライバシーポリシーに同意します。</small>
</div>
</div>
</div>
</section>
<section aria-labelledby="sample-section-2" class="tp-section" data-harness-component="section">
<div class="tp-wrap">
<h2 id="sample-section-2" class="tp-h2" data-harness-component="heading">対応方法</h2>
<div class="tp-paths" data-harness-component="paths">
<article class="tp-path" data-harness-component="path">
<h3 class="tp-h3" data-harness-component="heading">お手元の AI で直す</h3>
<p class="tp-text" data-harness-component="text">次の文を ChatGPT や Claude に貼ると、入れる値と手順を返します。</p>
<div class="tp-prompt-wrap" data-harness-component="prompt">
<div class="tp-prompt">会社のメールが届いているかを確かめ、足りない設定を管理画面に入れる値で教えてください。</div>
<button type="button" aria-label="コピー" title="コピー" class="tp-icon-button" data-harness-component="icon-button">
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
<rect x="9" y="9" width="12" height="12"/>
<path d="M5 15V3h12"/>
</svg>
</button>
</div>
<p class="tp-note" data-harness-component="note">
<a href="https://example.com/">手順を見る</a>
</p>
</article>
<article class="tp-path" data-harness-component="path">
<h3 class="tp-h3" data-harness-component="heading">Flapbase のエージェントで対応</h3>
<p class="tp-text" data-harness-component="text">設定の手順を作り、入れたあとに確かめます。</p>
<a href="https://example.com/" class="tp-button tp-button-primary" data-harness-component="button">エージェントで始める</a>
</article>
</div>
</div>
</section>
</div>
```

### 組む

1. 中身を上のテンプレートと部品に割り当てる。型にない物は、近い部品の値で組み、新しい値を足さない。
2. CSS は上の標準の CSS を使い、足す時も --fh- の変数だけで書く。
3. 字は短く事実を書く。同じ意味を2か所に書かない。断り書きを並べない。ボタンの字は行為を書く。
4. 組んだら次の検査を流し、違反が 0 件になるまで直す。

### 検査

ページを開いたブラウザで、次の script をそのまま流す（開発者ツールのコンソールか、ブラウザを動かす道具の JavaScript 実行）。375px と 1280px の幅で1回ずつ流す。返る値は、合否、規則ごとの件数、違反の一覧（規則・場所・測った値・あるべき値）。

```js
// Flapbase デザインハーネスの検査。ページを開いたブラウザで流すと、違反の一覧を返す。何も送らない。
(function () {
const HARNESS = {"version":1,"space":[4,8,12,16,24,32,48,64],"type":{"fine":12,"note":14,"body":16,"h3":17,"h2":22,"title":32,"titleWide":40},"typeFloor":12,"radius":4,"border":{"hairline":1,"strong":2,"style":"solid"},"shadow":"none","colors":{"bg.page":"#ffffff","text.primary":"#1f2933","text.secondary":"#6b7785","border.subtle":"#e3e8ec","border.strong":"#1f2933","action.primary.bg":"#0d7877","action.primary.fg":"#ffffff","border.focus":"#0d7877","signal.ok":"#12b76a","signal.warn":"#f79009","signal.bad":"#f04438"},"colorUse":{"text":["text.primary","text.secondary","action.primary.fg","action.primary.bg"],"border":["border.subtle","border.strong","border.focus","action.primary.bg"],"background":["bg.page","action.primary.bg","signal.ok","signal.warn","signal.bad"]},"controlHeight":44,"page":{"wrap":840,"gutter":{"narrow":16,"wide":24,"at":600},"sectionY":{"narrow":32,"wide":48,"at":768},"stackBelow":768},"focus":{"outline":"none","boxShadow":"none","border":"1px solid","color":"border.focus"},"motionMaxMs":150,"contrast":{"text":4.5,"large":3},"rules":[{"id":"width","statement":"セクションの内側の幅と左端が、すべて同じ","severity":"error"},{"id":"overflow","statement":"横にはみ出さない（375px と 1280px）","severity":"error"},{"id":"space-step","statement":"margin・padding・gap は余白の段（4・8・12・16・24・32・48・64）","severity":"warn"},{"id":"radius","statement":"角丸は 0・4px・50%（信号の丸）のどれか","severity":"error"},{"id":"border","statement":"線は 1px か 2px の solid","severity":"error"},{"id":"surface","statement":"背景の面で囲まない（白以外の背景はボタンと信号だけ）","severity":"error"},{"id":"shadow","statement":"影を付けない","severity":"error"},{"id":"focus","statement":"フォーカスは輪も影も出さず、1px solid の線の色だけを替える","severity":"error"},{"id":"color-role","statement":"文字・線・背景の色は、色の役割の値か信号の3色","severity":"error"},{"id":"contrast","statement":"文字と背景のコントラストは 4.5 以上（大きい字は 3 以上）","severity":"error"},{"id":"type-step","statement":"文字の大きさは段（12・14・16・17・22・32・40）","severity":"warn"},{"id":"type-floor","statement":"文字は 12px 未満にしない","severity":"error"},{"id":"tracking","statement":"見出しの字間を詰めない","severity":"warn"},{"id":"control-h","statement":"ボタンと入力欄の高さは 44px 以上","severity":"error"},{"id":"signal-label","statement":"信号の色の隣に語がある","severity":"error"},{"id":"primary-one","statement":"1つのまとまりに主のボタンは1つ","severity":"error"},{"id":"motion","statement":"動きは 150ms 以下","severity":"warn"},{"id":"words","statement":"「つなぐ」「節」を使わない（「接続」「セクション」）","severity":"error"},{"id":"color-literal","statement":"色を直書きしない。色の役割の変数を使う（値を決める変数の定義だけが例外）","severity":"error"},{"id":"component","statement":"同じ働きの部品は標準の部品を使う","severity":"warn"},{"id":"template","statement":"同じ種類のページは標準のテンプレートから作る","severity":"warn"}],"tokenPrefixes":["--fh-","--platform-","--flapbase-","--flap-"]};
const TEXT_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'DT', 'DD', 'TD', 'TH', 'LABEL', 'SUMMARY', 'A', 'BUTTON', 'SPAN', 'STRONG', 'EM', 'SMALL', 'CODE', 'PRE', 'TIME', 'FIGCAPTION', 'BLOCKQUOTE', 'LEGEND', 'CAPTION', 'DIV', 'INPUT', 'TEXTAREA', 'SELECT', 'B']
const MEDIA_TAGS = ['IMG', 'SVG', 'VIDEO', 'CANVAS', 'PICTURE', 'IFRAME', 'PATH', 'USE', 'G', 'CIRCLE', 'RECT', 'LINE', 'POLYLINE', 'POLYGON']
const SKIP_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'META', 'LINK', 'BR', 'HEAD', 'TITLE']
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/
const NAMED_COLOR = /(?:^|[\s,(])(?:white|black|red|blue|green|gray|grey|silver|orange|yellow|purple|pink|navy|teal|aqua|maroon|olive|lime|fuchsia)(?=$|[\s,)])/i
const COLOR_PROPS = /^(?:color|background|background-color|background-image|border|border-(?:top|right|bottom|left)(?:-color)?|border-color|outline|outline-color|fill|stroke|box-shadow|text-shadow|text-decoration|text-decoration-color|caret-color|accent-color|column-rule|column-rule-color)$/
const COMPONENT_CLASS = /(?:^|\s)tp-(?:notice|form|report|paths|path|terms|keep|button|icon-button|sum|table|prompt-wrap|signal)(?:\s|$)/

/** "rgb(31, 41, 51)" → { hex: "#1f2933", alpha: 1 }。透明は null。 */
function parseColor(value) {
  const m = /rgba?\(([^)]+)\)/.exec(value || '')
  if (!m) return null
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
  const alpha = parts.length > 3 ? parts[3] : 1
  if (alpha === 0) return null
  const hex = '#' + parts.slice(0, 3).map(function (n) { return Math.round(n).toString(16).padStart(2, '0') }).join('')
  return { hex: hex, alpha: alpha }
}

function measure(doc, win, options) {
  const opts = options || {}
  const scope = (opts.scope && doc.querySelector(opts.scope)) || doc.body
  const root = (opts.root && doc.querySelector(opts.root)) || doc.querySelector('.tp-page') || doc.querySelector('main') || doc.body
  const px = function (v) { const n = parseFloat(v); return isFinite(n) ? n : 0 }
  const ms = function (list) { return Math.max.apply(null, String(list || '0s').split(',').map(function (s) { const t = s.trim(); return t.endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000 }).concat([0])) }
  const where = function (el) {
    const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : []
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24)
    return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '') + (text ? ' 「' + text + '」' : '')
  }
  const vw = doc.documentElement.clientWidth
  // 画面の外に退けてある物（本文へ移動のリンクなど）は測らない。
  const visible = function (el, cs, r) { return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw && r.bottom + win.scrollY > 0 }
  const effectiveBg = function (el) {
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const c = parseColor(win.getComputedStyle(e).backgroundColor)
      if (c && c.alpha >= 0.99) return c.hex
    }
    return '#ffffff'
  }
  const ownText = function (el) {
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return (el.value || el.getAttribute('placeholder') || '').trim()
    let t = ''
    for (const n of el.childNodes) if (n.nodeType === 3) t += n.textContent
    return t.replace(/\s+/g, ' ').trim()
  }
  const isControl = function (el) {
    if (el.tagName === 'BUTTON' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return true
    if (el.tagName === 'INPUT') return ['checkbox', 'radio', 'hidden', 'range', 'color', 'file'].indexOf(el.type) < 0
    return el.getAttribute('role') === 'button' || /(^|[\s_-])(button|btn)([\s_-]|$)/.test(typeof el.className === 'string' ? el.className : '')
  }
  const groups = []
  const groupOf = function (el) {
    const g = el.closest('[data-harness-group], form, section, header, footer, aside, nav, dialog') || scope
    let i = groups.indexOf(g)
    if (i < 0) { groups.push(g); i = groups.length - 1 }
    return i
  }
  const elements = []
  const all = [scope].concat(Array.prototype.slice.call(scope.querySelectorAll('*')))
  for (const el of all) {
    if (SKIP_TAGS.indexOf(el.tagName.toUpperCase()) >= 0) continue
    const cs = win.getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (!visible(el, cs, r)) continue
    const tag = el.tagName.toUpperCase()
    const text = TEXT_TAGS.indexOf(tag) >= 0 ? ownText(el) : ''
    const signal = r.width <= 24 && r.height <= 24 && parseColor(cs.backgroundColor) ? (el.parentElement ? el.parentElement.textContent : '').replace(/\s+/g, ' ').trim() : null
    elements.push({
      where: where(el), tag: tag, media: MEDIA_TAGS.indexOf(tag) >= 0, control: isControl(el), group: groupOf(el),
      box: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      display: cs.display, position: cs.position,
      margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(px),
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px),
      gap: [cs.rowGap, cs.columnGap].map(function (v) { return v === 'normal' ? 0 : px(v) }),
      radius: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius],
      borderWidth: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(px),
      borderStyle: [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle],
      borderColor: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor].map(parseColor),
      background: parseColor(cs.backgroundColor), backgroundImage: cs.backgroundImage !== 'none',
      shadow: cs.boxShadow, outline: cs.outlineStyle !== 'none' && px(cs.outlineWidth) > 0,
      color: parseColor(cs.color), fontSize: px(cs.fontSize), fontWeight: px(cs.fontWeight), letterSpacing: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
      text: text, onBg: text ? effectiveBg(el) : null, signalLabel: signal,
      motionMs: Math.max(ms(cs.transitionDuration), ms(cs.animationDuration)),
      component: Boolean(el.closest('[data-harness-component]')),
      componentLike: COMPONENT_CLASS.test(typeof el.className === 'string' ? el.className : ''),
      inlineColor: COLOR_LITERAL.test(el.getAttribute('style') || '') ? el.getAttribute('style') : null,
      userColor: Boolean(el.closest('[data-harness-user-color]')),
    })
  }
  const focus = []
  const focusables = Array.prototype.slice.call(scope.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')).slice(0, 200)
  const active = doc.activeElement
  for (const el of focusables) {
    if (el.disabled || el.type === 'hidden') continue
    const before = win.getComputedStyle(el)
    const r = el.getBoundingClientRect()
    if (!visible(el, before, r)) continue
    const b = { border: px(before.borderTopWidth), color: parseColor(before.borderTopColor), decoration: parseColor(before.textDecorationColor) }
    // 動きの途中の値を読まないよう、測る間だけ transition を止める。
    const transition = el.style.transition
    el.style.transition = 'none'
    el.focus({ preventScroll: true })
    if (doc.activeElement !== el) { el.style.transition = transition; continue }
    const after = win.getComputedStyle(el)
    focus.push({
      where: where(el), border: b.border,
      outline: after.outlineStyle !== 'none' && px(after.outlineWidth) > 0, shadow: after.boxShadow,
      borderBefore: b.color, borderAfter: parseColor(after.borderTopColor), borderStyle: after.borderTopStyle, borderAfterWidth: px(after.borderTopWidth),
      decorationBefore: b.decoration, decorationAfter: parseColor(after.textDecorationColor),
    })
    el.blur()
    el.style.transition = transition
  }
  if (active && active.focus) active.focus({ preventScroll: true })
  const sections = Array.prototype.slice.call(root.querySelectorAll(':scope > section, .tp-section')).map(function (s) {
    const inner = s.querySelector(':scope > .tp-wrap') || s.firstElementChild || s
    const r = inner.getBoundingClientRect()
    return { where: where(s), left: Math.round(r.left), width: Math.round(r.width) }
  }).filter(function (s) { return s.width > 0 })
  const literals = []
  const scan = function (rules, href) {
    for (const rule of rules) {
      if (literals.length >= 200) return
      if (rule.cssRules && !rule.style) { scan(rule.cssRules, href); continue }
      if (!rule.style) continue
      for (let i = 0; i < rule.style.length; i++) {
        const prop = rule.style[i]
        const v = rule.style.getPropertyValue(prop)
        const literal = COLOR_LITERAL.test(v) || (COLOR_PROPS.test(prop) && NAMED_COLOR.test(v))
        if (literal) literals.push({ where: (href || 'style') + ' ' + (rule.selectorText || '@'), prop: prop, value: v.trim().slice(0, 60) })
      }
      if (rule.cssRules) scan(rule.cssRules, href)
    }
  }
  for (const sheet of Array.prototype.slice.call(doc.styleSheets)) {
    let rules = null
    try { rules = sheet.cssRules } catch (e) { rules = null }
    if (rules) scan(rules, sheet.href ? sheet.href.split('/').pop() : 'style')
  }
  const headings = Array.prototype.slice.call(scope.querySelectorAll('h1, h2, h3, h4, h5, h6, summary, legend')).map(function (h) { return h.textContent.replace(/\s+/g, ' ').trim() })
  return {
    url: String(win.location && win.location.href), viewport: doc.documentElement.clientWidth, scrollWidth: doc.documentElement.scrollWidth,
    pageBackground: effectiveBg(doc.body), sections: sections, elements: elements, focus: focus, headings: headings, literals: literals,
    template: root.getAttribute('data-harness-template'),
    text: (scope.innerText || scope.textContent || '').slice(0, 20000),
  }
}

function luminanceOf(hex) {
  const c = [1, 3, 5].map(function (i) { const s = parseInt(hex.slice(i, i + 2), 16) / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
function contrast(a, b) {
  const x = luminanceOf(a), y = luminanceOf(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

function judge(m, t) {
  const out = []
  const rules = {}
  for (const r of t.rules) rules[r.id] = r
  const add = function (rule, where, found, expected) { out.push({ rule: rule, severity: rules[rule].severity, where: where, found: String(found), expected: String(expected) }) }
  const colors = function (names) { return names.map(function (n) { return t.colors[n].toLowerCase() }) }
  const textColors = colors(t.colorUse.text), borderColors = colors(t.colorUse.border), backgrounds = colors(t.colorUse.background)
  const signals = colors(['signal.ok', 'signal.warn', 'signal.bad'])
  const page = t.colors['bg.page'].toLowerCase(), action = t.colors['action.primary.bg'].toLowerCase(), focusColor = t.colors['border.focus'].toLowerCase()
  const space = [0].concat(t.space)
  const types = Object.keys(t.type).map(function (k) { return t.type[k] })
  const near = function (v, list) { return list.some(function (s) { return Math.abs(v - s) < 0.5 }) }

  if (m.scrollWidth > m.viewport + 1) add('overflow', 'ページ', m.scrollWidth + 'px', m.viewport + 'px 以下')
  if (m.sections.length > 1) {
    const first = m.sections[0]
    for (const s of m.sections.slice(1)) if (Math.abs(s.left - first.left) > 1 || Math.abs(s.width - first.width) > 1) add('width', s.where, '左 ' + s.left + '・幅 ' + s.width, '左 ' + first.left + '・幅 ' + first.width)
  }
  if (m.pageBackground !== page) add('surface', 'ページの背景', m.pageBackground, page)
  if (!m.template) add('template', 'ページの根', 'テンプレートなし', '標準のテンプレートから作る')
  const prefixes = t.tokenPrefixes
  for (const l of m.literals || []) {
    if (l.prop.indexOf('--') === 0 && prefixes.some(function (p) { return l.prop.indexOf(p) === 0 })) continue
    add('color-literal', l.where, l.prop + ': ' + l.value, '色の役割の変数（' + prefixes.join(' ') + '）')
  }

  const primaries = {}
  for (const e of m.elements) {
    if (e.media) continue
    // 利用者が選んだ色を見せる所（色の見本など）は、色の検査から外す。
    const own = Boolean(e.userColor)
    const block = e.display !== 'inline' && e.display !== 'contents'
    if (block) {
      const centered = Math.abs(e.margin[1] - e.margin[3]) < 0.5 && e.margin[1] > 0
      const sides = centered ? [e.margin[0], e.margin[2]] : e.margin
      const bad = sides.concat(e.padding, e.gap).filter(function (v) { return v > 0 && !near(v, space) })
      if (bad.length) add('space-step', e.where, bad.map(function (v) { return Math.round(v * 10) / 10 + 'px' }).join('・'), t.space.join('・'))
    }
    for (const r of e.radius) if (['0px', t.radius + 'px', '50%'].indexOf(r) < 0) { add('radius', e.where, r, '0・' + t.radius + 'px・50%'); break }
    for (let i = 0; i < 4; i++) {
      const w = e.borderWidth[i]
      if (w === 0) continue
      if ((w !== t.border.hairline && w !== t.border.strong) || e.borderStyle[i] !== 'solid') { add('border', e.where, w + 'px ' + e.borderStyle[i], t.border.hairline + 'px か ' + t.border.strong + 'px の solid'); break }
    }
    for (let i = 0; i < 4; i++) {
      const c = e.borderColor[i]
      if (e.borderWidth[i] === 0 || !c) continue
      if (borderColors.indexOf(c.hex) < 0 || c.alpha < 1) { add('color-role', e.where, '線 ' + c.hex, borderColors.join('・')); break }
    }
    if (e.shadow && e.shadow !== 'none') add('shadow', e.where, e.shadow, 'none')
    const small = e.box.w <= 24 && e.box.h <= 24
    if (!own && e.background && e.background.hex !== page) {
      const allowed = (e.control && e.background.hex === action) || (small && signals.indexOf(e.background.hex) >= 0)
      if (!allowed) add('surface', e.where, '背景 ' + e.background.hex, '背景なし（' + page + '）')
      else if (backgrounds.indexOf(e.background.hex) < 0) add('color-role', e.where, '背景 ' + e.background.hex, backgrounds.join('・'))
    }
    if (!own && e.backgroundImage) add('surface', e.where, '背景の画像・グラデーション', 'なし')
    if (e.position === 'fixed' || e.position === 'sticky') { if (e.tag !== 'HEADER') add('surface', e.where, 'position:' + e.position, 'ページの中に置く') }
    if (small && e.background && signals.indexOf(e.background.hex) >= 0 && !e.signalLabel) add('signal-label', e.where, '語なし', '丸の隣に判定の語')
    if (e.control) {
      if (e.box.h < t.controlHeight - 0.5) add('control-h', e.where, e.box.h + 'px', t.controlHeight + 'px 以上')
      if (e.background && e.background.hex === action) primaries[e.group] = (primaries[e.group] || []).concat([e.where])
    }
    if (e.motionMs > t.motionMaxMs) add('motion', e.where, e.motionMs + 'ms', t.motionMaxMs + 'ms 以下')
    if ((e.control || e.componentLike) && !e.component) add('component', e.where, '個別に作った部品', '標準の部品を使う')
    if (e.inlineColor && !own) add('color-literal', e.where, 'style="' + e.inlineColor.slice(0, 60) + '"', '色の役割の変数')
    if (e.text) {
      if (!own && e.color && (textColors.indexOf(e.color.hex) < 0 || e.color.alpha < 1)) add('color-role', e.where, '文字 ' + e.color.hex + (e.color.alpha < 1 ? '（透過 ' + e.color.alpha + '）' : ''), textColors.join('・'))
      if (e.fontSize < t.typeFloor - 0.5) add('type-floor', e.where, e.fontSize + 'px', t.typeFloor + 'px 以上')
      else if (!near(e.fontSize, types)) add('type-step', e.where, e.fontSize + 'px', types.join('・'))
      if (/^H[1-6]$/.test(e.tag) && e.letterSpacing < 0) add('tracking', e.where, e.letterSpacing + 'px', '0 以上')
      if (!own && e.color && e.onBg) {
        const ratio = contrast(e.color.hex, e.onBg)
        const large = e.fontSize >= 24 || (e.fontSize >= 18.66 && e.fontWeight >= 700)
        const need = large ? t.contrast.large : t.contrast.text
        if (ratio < need - 0.005) add('contrast', e.where, ratio.toFixed(2) + '（' + e.color.hex + ' / ' + e.onBg + '）', need + ' 以上')
      }
    }
  }
  for (const g of Object.keys(primaries)) if (primaries[g].length > 1) add('primary-one', primaries[g].join(' と '), primaries[g].length + ' 個', '1 個')
  for (const f of m.focus) {
    if (f.outline) add('focus', f.where, 'outline あり', 'outline なし')
    if (f.shadow && f.shadow !== 'none') add('focus', f.where, '影 ' + f.shadow, '影なし')
    if (f.border > 0) {
      const changed = f.borderAfter && (!f.borderBefore || f.borderAfter.hex !== f.borderBefore.hex)
      if (!changed) add('focus', f.where, '線の色が変わらない', '線を ' + focusColor + ' に')
      // 主のボタンは線がもとからフォーカスの色なので、本文の色に替える。
      else if (f.borderAfter.hex !== (f.borderBefore && f.borderBefore.hex === focusColor ? t.colors['text.primary'].toLowerCase() : focusColor)) add('focus', f.where, '線 ' + f.borderAfter.hex, focusColor)
      if (f.borderAfterWidth !== t.border.hairline || f.borderStyle !== 'solid') add('focus', f.where, f.borderAfterWidth + 'px ' + f.borderStyle, '1px solid')
    }
  }
  if (/つなぐ|繋ぐ|つなげ|繋げ|つない|繋い|つなぎ|繋ぎ/.test(m.text)) add('words', '本文', '「つなぐ」', '「接続」')
  for (const h of m.headings) if (/節/.test(h)) add('words', '見出し「' + h.slice(0, 24) + '」', '「節」', '「セクション」')

  const counts = {}
  for (const v of out) counts[v.rule] = (counts[v.rule] || 0) + 1
  return { url: m.url, viewport: m.viewport, passed: !out.some(function (v) { return v.severity === 'error' }), counts: counts, violations: out }
}

function run(doc, win, t, options) { return judge(measure(doc, win, options), t) }
return run(document, window, HARNESS);
})()
```

結果は次の表にして返す。重さが「直す」の物から並べる。

| 規則 | 場所 | 測った値 | あるべき値 | 直し方 |
| --- | --- | --- | --- | --- |

規則の一覧：

| 規則 | 内容 | 重さ |
| --- | --- | --- |
| width | セクションの内側の幅と左端が、すべて同じ | 直す |
| overflow | 横にはみ出さない（375px と 1280px） | 直す |
| space-step | margin・padding・gap は余白の段（4・8・12・16・24・32・48・64） | 見直す |
| radius | 角丸は 0・4px・50%（信号の丸）のどれか | 直す |
| border | 線は 1px か 2px の solid | 直す |
| surface | 背景の面で囲まない（白以外の背景はボタンと信号だけ） | 直す |
| shadow | 影を付けない | 直す |
| focus | フォーカスは輪も影も出さず、1px solid の線の色だけを替える | 直す |
| color-role | 文字・線・背景の色は、色の役割の値か信号の3色 | 直す |
| contrast | 文字と背景のコントラストは 4.5 以上（大きい字は 3 以上） | 直す |
| type-step | 文字の大きさは段（12・14・16・17・22・32・40） | 見直す |
| type-floor | 文字は 12px 未満にしない | 直す |
| tracking | 見出しの字間を詰めない | 見直す |
| control-h | ボタンと入力欄の高さは 44px 以上 | 直す |
| signal-label | 信号の色の隣に語がある | 直す |
| primary-one | 1つのまとまりに主のボタンは1つ | 直す |
| motion | 動きは 150ms 以下 | 見直す |
| words | 「つなぐ」「節」を使わない（「接続」「セクション」） | 直す |
| color-literal | 色を直書きしない。色の役割の変数を使う（値を決める変数の定義だけが例外） | 直す |
| component | 同じ働きの部品は標準の部品を使う | 見直す |
| template | 同じ種類のページは標準のテンプレートから作る | 見直す |

## チェックリスト

- [ ] 375px と 1280px の両方で検査を流した
- [ ] 重さが「直す」の違反が 0 件
- [ ] 「見直す」の違反は、直したか、残す理由を書いた
- [ ] 信号は色と語を並べている
- [ ] 1つのまとまりに主のボタンは1つ
- [ ] 見た目の良し悪し（主が分かるか、読む順が自然か）は依頼主が確かめる

## 終わりの目安

375px と 1280px で検査の合否が「合格」になり、違反の表と、直す前と後の画面を依頼主に渡した。

## 次にできること

- 同じ型でほかのページを組み、検査を流す
- 検査の結果を毎回残し、規則ごとの件数の変化を見る

## Flapbase で続ける

なし。この skill は外の AI とブラウザだけで完結し、Cloud の入口はまだない。
