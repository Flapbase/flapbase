# Flapbase recruitment

`@flapbase/apps-recruitment/postgres` provides the PostgreSQL persistence used by Flapbase recruitment. Supply the runtime's canonical SHA-256 function, the fixed recruitment preset digest and an existing PostgreSQL transaction. The Host owns authentication, Project membership, approval authority, and snapshot delivery. Public pages and the MCP adapter use Host-provided authorization.

求人原稿の版、候補の検証・承認・反映、本人応募の再送、選考状態を既存のVDBと同じ形式で保存します。このパッケージには公開画面や認証を含まないため、利用するHostでそれらを接続します。
