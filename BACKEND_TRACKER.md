# SkyBook — Backend Build Tracker

- **Repository:** https://github.com/nutronstar-star/skybook
- **Architecture:** Modular Monolith (Fastify 4, Node 20 LTS, TypeScript Strict, Prisma 5, PostgreSQL 16, Redis 7, BullMQ)
- **Specification Source:** `flight-report.html` (72 FRs, 46 NFRs, 10 Business Rules, 21 DB Tables, 8 Modules)

## Wave Progress

| Wave | Step | Deliverable | Target FRs / NFRs | Status |
| :--- | :--- | :--- | :--- | :--- |
| Wave 1 | 1A | Monorepo, Git remote, Docker (PG16 + Redis7), `@skybook/shared` | `CON-T-01..08`, `NFR-M-02`, `FR-PAX-031` | DONE |
| Wave 1 | 1B | `@skybook/database` — 21 tables, partial unique seat constraints, append-only `audit_logs` SQL trigger, seed data | `BR-01..10`, `NFR-S-07`, `NFR-D-01..05` | DONE |
| Wave 1 | 1C | `@skybook/api` Core — Fastify 4, Pino PII scrubber, Redis rate-limit, RBAC + 404 tenant guard, `Idempotency-Key`, `audit` module | `FR-XC-001..008`, `FR-ADM-020..022`, `NFR-S-03..15` | DONE |
| Wave 2 | 2A | `identity` module — Phone/Email OTP, Admin Argon2id login + reset, session revocation cascade | `FR-PAX-001..005`, `FR-PAX-040..042`, `FR-ADM-001..003` | DONE |
| Wave 2 | 2B | `flight` module — Cities/airports autocomplete, aircraft layouts, flight lifecycle, Redis-cached search | `FR-PAX-006..011`, `FR-ADM-004..010`, `NFR-P-02` | DONE |
| Wave 3 | 3A | `booking` module — Redis `SET NX` (300s) + PG unique seat lock, atomic booking tx, AES-256-GCM PII, Admin masked/unmasked views | `FR-PAX-012..024`, `FR-ADM-011..015`, `NFR-P-03..04` | DONE |
| Wave 3 | 3B | WebSocket Gateway (`ws`) — RFC 6455 JWT auth + Redis Pub/Sub real-time seat updates | `FR-PAX-017`, `EI-07` | DONE |
| Wave 4 | 4A | `payment` module + BullMQ `webhook-worker` — Idempotent Razorpay orders, HMAC-SHA256 webhook, `MOCK_PAYMENT` | `FR-PAX-025..030`, `FR-XC-004`, `NFR-P-05` | DONE |
| Wave 4 | 4B | `ticket`, `refund`, `notification` modules + Workers — Ed25519 QR, deterministic refund tiers, Admin refund approval, SMTP worker | `FR-PAX-031..039`, `FR-ADM-016..019` | NEXT |
| Wave 5 | 5A | Vitest Suite — Unit, Contract, 10-req Concurrency (`1x201 + 9x409`), Webhook Idempotency, Audit Immutability (`>= 80%` coverage) | `SC-01..12`, `NFR-M-01` | PENDING |