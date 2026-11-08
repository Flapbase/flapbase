# Flapbase architecture (overview)

Flapbase is an AI workspace for growing your business. This page explains how it is put together, so that people and AI agents can understand the system and propose concrete improvements. It describes concepts and boundaries, not internal code.

## Building blocks

- **Flapps** — the apps people use: Site, Publish (articles and social posts), Design, Project, Workflow, Knowledge. Each Flapp works on shared data instead of keeping its own silo.
- **Blueprints** — typed definitions of data (fields, relations, versions). Every record follows a Blueprint. Extensions can add optional fields to a Blueprint without changing it.
- **VDB** — the data store for records that follow Blueprints. Tables are connected by relations, and **views** combine tables for a purpose (for example, a customer view over a directory of companies and people).
- **Actions** — every change goes through an Action with a clear owner, an expected version and an idempotency key. Publishing, approving and submitting are Actions; important decisions are always made by a person.
- **Projections** — rules that copy selected fields from one layer to another (for example, from internal product records to the public site).
- **MCP** — AI agents use Flapbase through MCP tools. Agents prepare and propose; people approve, publish and pay.

## Trust boundaries

Data lives in three separate boundaries, and information crosses them only through Actions:

1. **Inside a workspace** — personal, project and workspace records. Each record carries an access level (private, project, workspace).
2. **Outside users** — people who use a Flapp built on Flapbase (members, bookings, purchases). They only see their own records and what their entitlements allow.
3. **Public** — published sites and CMS collections, served as immutable releases. Public delivery never reads internal data.

## How work flows

Plan → make → review → publish → improve. Each feature in [/features.json](https://flapbase.com/features.json) says which stage it belongs to, how it appears on screen, and whether it is a candidate for the open-source edition.

## Open source and Cloud

- **Open source** (in progress): Flapbase itself, run locally, with your data in your own files. Tools and skills that run locally send nothing to Flapbase.
- **Flapbase Cloud**: working with others, Flapbase AI, APIs, hosting and publishing, advanced Flapps. You can start locally and move to Cloud as is.
- The exact line is still being drawn; /features.json marks each feature as `oss-candidate`, `cloud` or `undecided`.

## Where you can extend

- Add fields with Blueprint extensions; build views over tables and relations.
- Add skills for AI agents.
- Build Flapps on the same Blueprints and Actions.

## How to propose improvements

Pull requests and issues are closed. Send proposals from your AI agent with `feedback_send` (signed-in Flapbase Cloud users) or from the feedback button in the app:

- **Improve an existing feature**: give its `featureKey` from /features.json, the problem, and your proposal.
- **Propose something new**: leave out `featureKey`, choose the area (data, ui, workflow, publish, mcp), and list related feature keys if any.

Good proposals name the feature, describe the situation where it falls short, and suggest a change that fits the building blocks above.

---

## 日本語

Flapbase は事業を伸ばすための AI ワークスペースです。この頁は、人と AI エージェントが仕組みを理解し、具体的な改善を提案できるように、組み立てを説明します。内部のコードではなく、考え方と境目を書いています。

- **組み立て**：Flapp（Site・Publish・Design・Project・ワークフロー・ナレッジ）／Blueprint（データの型。拡張で任意の項目を足せる）／VDB（Blueprint に沿った記録の置き場。表を関連でつなぎ、ビューでまとめる）／Action（変更はすべて Action を通す。大事な判断は人）／Projection（層の間で選んだ項目を写す決まり）／MCP（エージェントは準備と提案、人が承認・公開・支払い）。
- **信頼の境目**：ワークスペースの中（記録ごとに自分だけ・Project・ワークスペースの印）／外の利用者（自分の記録と利用権で許された物だけ）／公開（変えない公開版で配る。公開の配信は内のデータを読まない）。境目を越えるのは Action だけ。
- **流れ**：企画→制作→確認→発信→改善。/features.json の各機能に段・画面での置き方・OSS の候補かを書く。
- **OSS と Cloud**：OSS は Flapbase 自体を手元で（準備中）。手元の道具と skill は何も送らない。Cloud は共同作業・Flapbase AI・API・配信と公開・高度な Flapp。手元で始めて Cloud へそのまま移れる。線引きは決めている途中。
- **広げられる所**：拡張で項目を足す・表と関連でビューを作る・skill・同じ Blueprint と Action で Flapp を作る。
- **改善の提案のしかた**：Issues と PR は閉じている。feedback_send（Cloud にログインした人）かアプリのフィードバックから。既存の機能の改善は featureKey と困りごとと提案、新しい提案は featureKey なしで段（data・ui・workflow・publish・mcp）と近い機能の鍵。
