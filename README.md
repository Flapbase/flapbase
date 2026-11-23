# Flapbase - Agentic Business Framework

**Launch and run a digital business with your AI agent.**

Publish a product page, take signups, deliver what customers signed up for, and handle their questions from the same project. Start with one of 11 standard business workflows.

[日本語](#日本語)

| What you can launch | What you can run |
| --- | --- |
| Free resource or digital product | Accept signups, deliver downloads, and handle order questions |
| Online course | Prepare lessons, give members access, and review unanswered questions |
| Booking service | Publish availability, take bookings, and track outcomes |
| Paid membership | Publish an offer and manage member access, renewals, and cancellations |

## Try it with a free download

`Preview the landing page → Prepare the offer with your agent → Review and publish → Take signups with Flap ID → Deliver the file and handle inquiries`

1. With Node.js 22 or later, clone the repo and start the preview.

   ```sh
   git clone https://github.com/Flapbase/flapbase.git
   cd flapbase
   node examples/cloud-starter/run.mjs
   ```

2. Open [the local preview](http://127.0.0.1:5264/) and edit the title and description in [site.base.json](examples/cloud-starter/site.base.json).
3. Connect your agent to Flapbase Cloud over MCP. It can prepare a free offer from your file. Review and publish it in Cloud, then set `productId` in the starter to enable signups. [MCP setup](https://flapbase.com/agents) · [Starter walkthrough](examples/cloud-starter/README.md)
4. Check signups in Orders. When a customer asks about their order, your agent can find the inquiry through MCP and save a reply draft for you to review.

## Start another business

List the available workflows and inspect the one you want to use.

```sh
node bin/flap.js business list
node bin/flap.js business inspect booking-service
```

The list is returned as JSON and includes these business keys.

```text
member-ai-course
standard-service
free-resource
recruitment
digital-product-sales
organization-training
paid-membership
booking-service
event-registration
customer-sales
customer-support
```

<details>
<summary>Command to print only the business keys</summary>

```sh
node bin/flap.js business list | node -pe 'JSON.parse(require("node:fs").readFileSync(0)).map(b => b.businessKey).join("\n")'
```

</details>

The `.base` catalog records the workflow, the inputs and the operations an agent can call. The connected agent can look up the catalog with `app_template_get` and execute a registered step with `business_workflow_step_run`. Publishing and customer-facing actions follow the project's permissions and approvals. [All 11 workflows and MCP commands](packages/business-workflows/README.md)

## Where it runs

- **With your own frontend.** Use the OSS starter or your own code, and connect the operational backend to Flapbase Cloud.
- **In Flapbase Cloud.** Build and operate from the hosted interface and connect your agent over MCP. [Flapbase Cloud](https://flapbase.com)
- **On your own host.** Run the documented local workflows with PostgreSQL. [Self-host setup and scope](packages/self-host/README.md)

## Before publishing

Use the bundled site check to review how search engines and AI read your pages and to spot common publishing problems. [Site check guide](docs/site-check.md)

## Development and feedback

```sh
pnpm test
pnpm check:release
```

[Architecture](docs/architecture.md) · [Examples](examples/README.md) · [Skills documentation](docs/skills.md)

Send feedback through the app or an agent connected over MCP. Issues and pull requests are closed. [Security reports](SECURITY.md)

Apache-2.0. [License](LICENSE) · [Notices](NOTICE)

---

## 日本語

**AIエージェントと事業を作り、成長させる**

デジタル商品、講座、予約、会員サービスなど11事業の標準ワークフローから選べます。告知ページを公開し、申込・提供・顧客対応を同じプロジェクトで進めます。

### 無料資料で始める

`告知ページをプレビュー → AIが出品を準備 → 人が確認して公開 → Flap IDで申込 → 本人受取・問い合わせ対応`

Node.js 22以上で次のコマンドを実行します。

```sh
git clone https://github.com/Flapbase/flapbase.git
cd flapbase
node examples/cloud-starter/run.mjs
```

[ローカルプレビュー](http://127.0.0.1:5264/)を開き、[site.base.json](examples/cloud-starter/site.base.json)で告知を編集します。AIエージェントをMCPでCloudにつなぐと、登録した資料をもとに無料商品の準備を任せられます。確認して公開した商品のIDを `productId` に設定すると、告知ページから申込へ進めます。 [MCP接続](https://flapbase.com/agents) · [設定と公開の手順](examples/cloud-starter/README.md)

運営者はCloudの「注文」で申込を確認できます。問い合わせが入ったら、AIが該当する注文を照会し、返信案を保存します。返信は運営者が確認します。

### ほかの事業を選ぶ

`node bin/flap.js business list` で事業を選び、たとえば `node bin/flap.js business inspect booking-service` で予約サービスの工程とAIが使える操作を確認できます。 [11事業の標準定義と実行手順](packages/business-workflows/README.md#日本語)

OSSのフロントをCloudのバックエンドにつなぐ方法、Cloud内で制作から運営まで行う方法、PostgreSQLで対応するフローを自分で動かす方法があります。 [セルフホストの手順と対応範囲](packages/self-host/README.md)

公開前には検索・AIからの読まれ方や公開用ファイルをローカルで点検できます。 [サイト点検ガイド](docs/site-check.md#日本語)
