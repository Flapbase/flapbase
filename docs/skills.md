# Flapbase Skills

[日本語](#日本語)

## Use from AI agents

Install the skills in Claude Code, Codex (ChatGPT) and other agents with one line:

```sh
npx skills add Flapbase/flapbase
```

Skills are grouped by what you are trying to do. Within a group, use them top to bottom.

**Understand the business**

| Skill | What it does |
| --- | --- |
| [flapbase-acquisition-check](../skills/flapbase-acquisition-check/SKILL.md) | Lays out ad spend, visits, inquiries, deals and sales, shows where people drop off and what each lead costs |
| [flapbase-business-profile-check](../skills/flapbase-business-profile-check/SKILL.md) | Checks the business profile and service list, and rewrites the profile so it earns trust and inquiries |
| [flapbase-ai-adoption](../skills/flapbase-ai-adoption/SKILL.md) | Starts using chat AI at work: which tasks to hand off, prompt templates, and what not to put into AI |
| [flapbase-business-map](../skills/flapbase-business-map/SKILL.md) | Answers "what should we fix now?" by picking one question and only the analyses it needs, with evidence marked as observed, external, estimated or hypothesis |
| [flapbase-measures-inventory](../skills/flapbase-measures-inventory/SKILL.md) | Takes stock of your marketing as audience × action × tool, without forms, and finds what to add, fix, tidy or stop |

**Site and AI visibility** (in order)

| Skill | What it does |
| --- | --- |
| [flapbase-site-check](../skills/flapbase-site-check/SKILL.md) | 1. Runs the site check locally and explains the fixes |
| [flapbase-site-diagnosis](../skills/flapbase-site-diagnosis/SKILL.md) | 2. Checks the content: what an AI needs to recommend the site |
| [flapbase-ai-visibility](../skills/flapbase-ai-visibility/SKILL.md) | 3. Checks every week whether AI assistants name the business correctly, and which comparison searches and lists matter |
| [flapbase-mail-check](../skills/flapbase-mail-check/SKILL.md) | Checks whether email to customers is set up to arrive (SPF, DKIM, DMARC) from public DNS, and gives the values to enter |
| [flapbase-site-migrate](../skills/flapbase-site-migrate/SKILL.md) | Moves an existing site (HTML, React, Astro, WordPress export) into Flap Site |

**Publishing**

| Skill | What it does |
| --- | --- |
| [flapbase-sns-check](../skills/flapbase-sns-check/SKILL.md) | Checks a social profile and recent posts, then gives 10 post ideas and 3 posts ready to use |
| [flapbase-article-acquisition](../skills/flapbase-article-acquisition/SKILL.md) | Brings visitors from search and AI assistants with articles that answer real customer questions |
| [flapbase-curation-publishing](../skills/flapbase-curation-publishing/SKILL.md) | Picks surprising, fact-checked topics from overseas news and posts, and rewrites them in Japanese for X and articles, with UIL in Flapbase Cloud |
| [flapbase-sns-operations](../skills/flapbase-sns-operations/SKILL.md) | Runs social media operations as 12 workflows across planning, making, publishing and improving |
| [flapbase-post-check](../skills/flapbase-post-check/SKILL.md) | Checks social posts locally before they go out |
| [flapbase-post-assist](../skills/flapbase-post-assist/SKILL.md) | Rewrites copy and drafts X and Instagram posts from the same materials, with Flapbase Cloud |

**Creative work**

| Skill | What it does |
| --- | --- |
| [flapbase-creative-brief](../skills/flapbase-creative-brief/SKILL.md) | Confirms who the work is for and what they should do before making an LP, banner or social image, and leaves a brief with the reasons for the layout |
| [flapbase-retainer-menu](../skills/flapbase-retainer-menu/SKILL.md) | Turns repeat client work into a monthly menu (hours, scope, rollover, rush work) with the proposal text |
| [flapbase-design-harness](../skills/flapbase-design-harness/SKILL.md) | Builds web pages and screens to one set of rules (spacing, type, corners, lines, colour roles, focus) and measures them in the browser |

**Improve**

| Skill | What it does |
| --- | --- |
| [flapbase-split-test](../skills/flapbase-split-test/SKILL.md) | Compares two versions at a scale that fits your numbers, and turns the result into insight |

**Checklists**

| Skill | What it does |
| --- | --- |
| [flapbase-tax-filing-prep](../skills/flapbase-tax-filing-prep/SKILL.md) | Prepares the year-end tax return with a principle-level checklist; checks dates and amounts in official guidance every year, and never calculates or files |
| [flapbase-checklist-monthly-close](../skills/flapbase-checklist-monthly-close/SKILL.md) | Closes the month: unbilled work, unpaid invoices, receipts, fixed costs and the numbers |
| [flapbase-checklist-year-prep](../skills/flapbase-checklist-year-prep/SKILL.md) | Prepares the year: contracts and fixed costs, deadlines, ownership of accounts, goals and budget |
| [flapbase-checklist-accounts](../skills/flapbase-checklist-accounts/SKILL.md) | Checks business accounts and permissions every quarter, without touching passwords or keys |

**Work in Flapbase Cloud**

| Skill | What it does |
| --- | --- |
| [flapbase-workflow](../skills/flapbase-workflow/SKILL.md) | Runs workflows |
| [flapbase-projects-tasks](../skills/flapbase-projects-tasks/SKILL.md) | Works with Projects and tasks |
| [flapbase-publish-work](../skills/flapbase-publish-work/SKILL.md) | Publishes work from Site and Design |
| [flapbase-connect-mcp](../skills/flapbase-connect-mcp/SKILL.md) | Connects to Flapbase Cloud over MCP |
| [flapbase-join](../skills/flapbase-join/SKILL.md) | Signs up to Flapbase Cloud, with the owner's confirmation |
| [flapbase-handoff](../skills/flapbase-handoff/SKILL.md) | Leaves a handoff note |
| [flapbase-feedback](../skills/flapbase-feedback/SKILL.md) | Sends feedback to Flapbase from Flapbase Cloud, after the owner confirms |
| [flapbase-guardrails](../skills/flapbase-guardrails/SKILL.md) | Rules to keep: personal data and what people decide |

The diagnoses, checklists and planning skills run with your own AI and send nothing. The other skills work locally where they can, and use Flapbase Cloud through MCP when you connect it. The full list with plain descriptions is at https://flapbase.com/skills. Only flapbase-feedback sends anything to Flapbase, and only after the owner confirms.

## 日本語

```sh
npx skills add Flapbase/flapbase
```

診断・チェックリスト・企画のスキルは、お持ちの AI だけで動き、何も送りません。ほかのスキルは、手元でできる所は手元で進め、接続したときは MCP で Flapbase Cloud を使います。一覧と説明は https://flapbase.com/skills にあります。
