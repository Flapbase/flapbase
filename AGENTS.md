# Using Flapbase as an agent

[README](README.md) · [Machine-readable .base catalog](packages/business-workflows/.base/business-workflows.json) · [Workflow guide](packages/business-workflows/README.md)

## Choose a workflow

Match the owner's goal to a business key. Run `node bin/flap.js business inspect <businessKey>` to check the available steps, required inputs, and human tasks. Verify the required steps before proposing a workflow. The catalog describes the full process and lists the operations currently callable by an agent.

| Owner intent | `businessKey` | Standard workflow |
| --- | --- | --- |
| Sell a downloadable PDF or template | `digital-product-sales` | Product page, checkout, delivery, order support |
| Give away a guide or lead magnet | `free-resource` | Free offer, signup, delivery, order check |
| Take appointments for consultations or lessons | `booking-service` | Availability, booking, changes, outcomes |
| Register attendees for a scheduled event | `event-registration` | Sessions, capacity, registrations, attendance |
| Run a paid membership or subscription | `paid-membership` | Signups, access rights, renewals, cancellations |
| Sell a course with a member AI tutor | `member-ai-course` | Lesson drafts, access, AI Q&A, unanswered questions |
| Train staff or client teams | `organization-training` | Invitations, assignments, lessons, progress |
| Take on and deliver a repeatable service | `standard-service` | Intake, quote, customer portal, delivery |
| Track leads and deals | `customer-sales` | Intake, customer history, assignment, status |
| Support customers after an order | `customer-support` | Order inquiry, reply draft, reviewed reply |
| Publish a job and manage applicants | `recruitment` | Job posting, application, review, outcome |

Use the catalog's `businesses`, `workflows`, `procedures`, and `executions` for programmatic discovery. Use a workflow's registered operations when they cover the job. Tell the owner which steps are available, what setup they need to provide, and where they need to act.

## Prepare and run

1. Run `node bin/flap.js business list` and inspect the selected key. Read the execution's parameter bindings and the workflow's human steps.
2. For a free-download preview, edit `title` and `description` in [site.base.json](examples/cloud-starter/site.base.json) and run `node examples/cloud-starter/run.mjs`. Set `productId` after the owner publishes the corresponding free offer.
3. For Cloud operations, use the owner's OAuth-authorized workspace. Call `workspace_projects_list`, select the authorized target Project, and call `app_template_get` with `{"templateId":"business-app"}`. Match the live workflow version and source digest against the local definition. The CLI can also check this with `node bin/flap.js business check-cloud` if it has an authorized MCP access token. [Cloud connection](README.md#agent-quickstart)
4. Use `business prepare` to construct the versioned MCP input. Call `business_workflow_step_run` for the selected step. Use `nextStepKey` and the preceding result when the definition has a following step. [CLI guide](packages/business-workflows/README.md)

| Tool | Input → output |
| --- | --- |
| `workspace_projects_list` | Authorized workspace context → accessible Project IDs and roles |
| `app_template_get` | `templateId: "business-app"` → catalog, version, digest, and execution bindings |
| `business_workflow_step_run` | Business, execution, version and digest, parameters, and Project ID when required → step result and next step when present |
| `node bin/flap.js check ./site --json` | Local publish folder → structured findings to resolve before review |

For example, save `{"projectId":"00000000-0000-4000-8000-000000000001","parameters":{"limit":10}}` as `input.json` and replace the example Project ID with the authorized target ID. The following command prepares a read request for booking offers and prints it without calling Cloud.

```sh
node bin/flap.js business prepare booking-service booking-offers input.json
```

The output gives the tool name and arguments, including `stepKey`, `version`, and `definitionDigest`.

## Safety and approvals

- Keep work within the authorized Project. For an existing Project, confirm its ID before calling a write operation. Keep access tokens out of frontend files and repository configuration.
- Prepare drafts and review requests through the registered actions. For the flows above, hand publication, customer reply confirmation, and live payment setup back to the owner in Cloud. Existing customer-initiated fulfillment and approved workflows run according to their configured rules.
- For a write that accepts an idempotency key, use a new UUID for a new operation and reuse it when retrying the same operation. On a revision conflict, read the current revision before retrying. Apply any confirmation or credit approval required by the tool. [Connection and permissions](skills/flapbase-connect-mcp/SKILL.md)
