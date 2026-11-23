# Step delivery

`validateScenario`, `matchesDeliveryCondition` and `stepDueAt` are deterministic and independent of the delivery channel. `StepDeliveryEngine` runs draft, approval, enrollment and delivery steps using a host-provided transaction store and transport. `src/step-delivery.d.ts` defines both adapters.

営業や資料提供の条件判定と、Email・LINEの段階配信に使います。Hostは認可、トランザクション、送信直前の同意と承認の再確認を担います。このパッケージに外部サービスの資格情報や、配信を自動起動する設定は含まれません。
