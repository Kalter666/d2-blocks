// Search and display metadata for the bundled .d2 examples.
export const EXAMPLE_CATEGORIES = [
  "Web & apps",
  "Distributed systems",
  "Data & AI",
  "Cloud & operations",
  "Security"
];

export const EXAMPLE_DEFINITIONS = [
  {
    "id": "three-tier",
    "title": "Three-tier web app",
    "category": "Web & apps",
    "description": "A classic web, application, and data architecture.",
    "tags": [
      "beginner",
      "web",
      "database"
    ]
  },
  {
    "id": "ecommerce",
    "title": "E-commerce microservices",
    "category": "Web & apps",
    "description": "Storefront, domain services, messaging, and separate data stores.",
    "tags": [
      "microservices",
      "retail",
      "events"
    ]
  },
  {
    "id": "realtime-chat",
    "title": "Real-time chat",
    "category": "Web & apps",
    "description": "Persistent WebSockets, presence, fan-out, and message storage.",
    "tags": [
      "websocket",
      "realtime",
      "messaging"
    ]
  },
  {
    "id": "video-streaming",
    "title": "Video streaming platform",
    "category": "Web & apps",
    "description": "Upload, transcode, package, distribute, and play video.",
    "tags": [
      "media",
      "cdn",
      "pipeline"
    ]
  },
  {
    "id": "url-shortener",
    "title": "URL shortener",
    "category": "Web & apps",
    "description": "Low-latency redirects with key generation, caching, and analytics.",
    "tags": [
      "cache",
      "high scale",
      "analytics"
    ]
  },
  {
    "id": "social-feed",
    "title": "Social feed",
    "category": "Web & apps",
    "description": "Hybrid fan-out for publishing and serving personalized feeds.",
    "tags": [
      "social",
      "fanout",
      "cache"
    ]
  },
  {
    "id": "ride-sharing",
    "title": "Ride sharing",
    "category": "Web & apps",
    "description": "Location ingestion, driver matching, trips, and notifications.",
    "tags": [
      "geospatial",
      "realtime",
      "mobile"
    ]
  },
  {
    "id": "event-driven",
    "title": "Event-driven architecture",
    "category": "Distributed systems",
    "description": "Producers and independent consumers connected by an event backbone.",
    "tags": [
      "events",
      "pubsub",
      "decoupling"
    ]
  },
  {
    "id": "cqrs",
    "title": "CQRS and event sourcing",
    "category": "Distributed systems",
    "description": "Separate command and query paths built from an immutable event log.",
    "tags": [
      "cqrs",
      "event sourcing",
      "projections"
    ]
  },
  {
    "id": "saga",
    "title": "Order saga",
    "category": "Distributed systems",
    "description": "An orchestrated transaction with compensating actions.",
    "tags": [
      "saga",
      "transactions",
      "microservices"
    ]
  },
  {
    "id": "service-mesh",
    "title": "Service mesh",
    "category": "Distributed systems",
    "description": "East-west traffic controlled by sidecars and a shared control plane.",
    "tags": [
      "mesh",
      "kubernetes",
      "mTLS"
    ]
  },
  {
    "id": "multi-region",
    "title": "Active-active multi-region",
    "category": "Distributed systems",
    "description": "Global routing across two active regions with replicated data.",
    "tags": [
      "resilience",
      "global",
      "replication"
    ]
  },
  {
    "id": "rate-limiter",
    "title": "Distributed rate limiter",
    "category": "Distributed systems",
    "description": "Edge enforcement backed by shared counters and policy.",
    "tags": [
      "api",
      "redis",
      "reliability"
    ]
  },
  {
    "id": "batch-pipeline",
    "title": "Batch data pipeline",
    "category": "Data & AI",
    "description": "Ingest, validate, transform, warehouse, and publish BI datasets.",
    "tags": [
      "etl",
      "warehouse",
      "batch"
    ]
  },
  {
    "id": "streaming-analytics",
    "title": "Streaming analytics",
    "category": "Data & AI",
    "description": "Real-time event processing with hot and cold serving paths.",
    "tags": [
      "streaming",
      "analytics",
      "realtime"
    ]
  },
  {
    "id": "lakehouse",
    "title": "Data lakehouse",
    "category": "Data & AI",
    "description": "Open table storage shared by batch, streaming, SQL, and ML.",
    "tags": [
      "lakehouse",
      "data platform",
      "ml"
    ]
  },
  {
    "id": "mlops",
    "title": "MLOps platform",
    "category": "Data & AI",
    "description": "From features and experiments to deployment and drift monitoring.",
    "tags": [
      "machine learning",
      "deployment",
      "monitoring"
    ]
  },
  {
    "id": "rag",
    "title": "Retrieval-augmented generation",
    "category": "Data & AI",
    "description": "Document ingestion and a grounded LLM question-answering path.",
    "tags": [
      "rag",
      "llm",
      "vector database"
    ]
  },
  {
    "id": "serverless",
    "title": "Serverless web backend",
    "category": "Cloud & operations",
    "description": "Managed edge, functions, queues, database, and object storage.",
    "tags": [
      "serverless",
      "functions",
      "cloud"
    ]
  },
  {
    "id": "kubernetes",
    "title": "Kubernetes application",
    "category": "Cloud & operations",
    "description": "Ingress, workloads, service discovery, state, and cluster operations.",
    "tags": [
      "kubernetes",
      "containers",
      "platform"
    ]
  },
  {
    "id": "cicd",
    "title": "CI/CD deployment pipeline",
    "category": "Cloud & operations",
    "description": "Build, verify, publish, deploy, observe, and roll back.",
    "tags": [
      "devops",
      "delivery",
      "gitops"
    ]
  },
  {
    "id": "observability",
    "title": "Observability platform",
    "category": "Cloud & operations",
    "description": "Unified collection and analysis of metrics, logs, and traces.",
    "tags": [
      "metrics",
      "logs",
      "tracing"
    ]
  },
  {
    "id": "disaster-recovery",
    "title": "Disaster recovery",
    "category": "Cloud & operations",
    "description": "Primary infrastructure, backups, standby recovery, and failover.",
    "tags": [
      "backup",
      "resilience",
      "failover"
    ]
  },
  {
    "id": "oauth",
    "title": "OAuth 2.0 authorization code",
    "category": "Security",
    "description": "Browser sign-in with authorization code and protected API access.",
    "tags": [
      "oauth",
      "identity",
      "authentication"
    ]
  },
  {
    "id": "zero-trust",
    "title": "Zero-trust access",
    "category": "Security",
    "description": "Every request is authenticated, authorized, and continuously evaluated.",
    "tags": [
      "zero trust",
      "policy",
      "identity"
    ]
  },
  {
    "id": "secrets",
    "title": "Secrets management",
    "category": "Security",
    "description": "Workload identity, short-lived credentials, rotation, and auditing.",
    "tags": [
      "secrets",
      "credentials",
      "rotation"
    ]
  },
  {
    "id": "iot",
    "title": "IoT telemetry platform",
    "category": "Distributed systems",
    "description": "Device identity, telemetry ingestion, rules, storage, and remote commands.",
    "tags": [
      "iot",
      "telemetry",
      "devices"
    ]
  },
  {
    "id": "saga-choreography",
    "title": "Choreographed order saga",
    "category": "Distributed systems",
    "description": "Domain services coordinate an order through events without a central orchestrator.",
    "tags": [
      "saga",
      "choreography",
      "events"
    ]
  },
  {
    "id": "saga-travel-booking",
    "title": "Travel booking saga",
    "category": "Distributed systems",
    "description": "Coordinate flight, hotel, car, and payment reservations with cancellation steps.",
    "tags": [
      "saga",
      "orchestration",
      "compensation"
    ]
  },
  {
    "id": "saga-payment-settlement",
    "title": "Payment settlement saga",
    "category": "Distributed systems",
    "description": "Risk checks, ledger reservations, bank settlement, and reconciliation.",
    "tags": [
      "saga",
      "payments",
      "reconciliation"
    ]
  },
  {
    "id": "saga-provisioning",
    "title": "Tenant provisioning saga",
    "category": "Distributed systems",
    "description": "Provision identity, database, storage, and billing resources with cleanup.",
    "tags": [
      "saga",
      "provisioning",
      "compensation"
    ]
  },
  {
    "id": "saga-subscription",
    "title": "Subscription upgrade saga",
    "category": "Distributed systems",
    "description": "Safely coordinate plan changes, payment, entitlements, and refunds.",
    "tags": [
      "saga",
      "subscriptions",
      "billing"
    ]
  },
  {
    "id": "saga-return-refund",
    "title": "Return and refund saga",
    "category": "Distributed systems",
    "description": "Manage return approval, parcel inspection, refund, and restocking.",
    "tags": [
      "saga",
      "returns",
      "refunds"
    ]
  },
  {
    "id": "saga-food-delivery",
    "title": "Food delivery saga",
    "category": "Distributed systems",
    "description": "Coordinate restaurant acceptance, payment, courier dispatch, and cancellation.",
    "tags": [
      "saga",
      "delivery",
      "realtime"
    ]
  },
  {
    "id": "saga-timeout-recovery",
    "title": "Saga timeout and recovery",
    "category": "Distributed systems",
    "description": "Durable state, deadlines, retries, dead letters, and manual recovery.",
    "tags": [
      "saga",
      "retries",
      "recovery"
    ]
  }
];
