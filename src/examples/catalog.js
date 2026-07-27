// Structure of the bundled .d2 examples: a stable `id` (the .d2 filename and the
// i18n key) and its `category`. The translatable title/description/tags live per
// language under `examples` in src/i18n/*.js — see i18n/index.svelte.js `example()`.
export const EXAMPLE_CATEGORIES = [
  "Web & apps",
  "Distributed systems",
  "Data & AI",
  "Cloud & operations",
  "Security"
];

export const EXAMPLE_DEFINITIONS = [
  { id: "three-tier", category: "Web & apps" },
  { id: "ecommerce", category: "Web & apps" },
  { id: "realtime-chat", category: "Web & apps" },
  { id: "video-streaming", category: "Web & apps" },
  { id: "url-shortener", category: "Web & apps" },
  { id: "social-feed", category: "Web & apps" },
  { id: "ride-sharing", category: "Web & apps" },
  { id: "event-driven", category: "Distributed systems" },
  { id: "cqrs", category: "Distributed systems" },
  { id: "saga", category: "Distributed systems" },
  { id: "service-mesh", category: "Distributed systems" },
  { id: "multi-region", category: "Distributed systems" },
  { id: "rate-limiter", category: "Distributed systems" },
  { id: "batch-pipeline", category: "Data & AI" },
  { id: "streaming-analytics", category: "Data & AI" },
  { id: "lakehouse", category: "Data & AI" },
  { id: "mlops", category: "Data & AI" },
  { id: "rag", category: "Data & AI" },
  { id: "serverless", category: "Cloud & operations" },
  { id: "kubernetes", category: "Cloud & operations" },
  { id: "cicd", category: "Cloud & operations" },
  { id: "observability", category: "Cloud & operations" },
  { id: "disaster-recovery", category: "Cloud & operations" },
  { id: "oauth", category: "Security" },
  { id: "zero-trust", category: "Security" },
  { id: "secrets", category: "Security" },
  { id: "iot", category: "Distributed systems" },
  { id: "saga-choreography", category: "Distributed systems" },
  { id: "saga-travel-booking", category: "Distributed systems" },
  { id: "saga-payment-settlement", category: "Distributed systems" },
  { id: "saga-provisioning", category: "Distributed systems" },
  { id: "saga-subscription", category: "Distributed systems" },
  { id: "saga-return-refund", category: "Distributed systems" },
  { id: "saga-food-delivery", category: "Distributed systems" },
  { id: "saga-timeout-recovery", category: "Distributed systems" }
];
