# Migrations

Evolution OS production schema is migration-only and append-only. Do not create or alter production tables manually without a matching migration.

Current migration families cover Mission/Job/Event/Artifact persistence, Realtime, Organization Capabilities + pgvector/RBAC, Immutable Evidence Ledger, durable Release Approvals, Outcome samples, encrypted Server Vault, and the Organization Member Directory.

Security invariants:
- production data is server-mediated; browser clients do not receive service-role credentials;
- all Evolution business tables end with RLS enabled and PUBLIC/anon/authenticated table privileges revoked;
- SECURITY DEFINER RPCs explicitly revoke PostgreSQL PUBLIC execute privileges and grant only service_role;
- the evolution-artifacts bucket remains private and legacy anon Storage policies stay removed;
- *_security_invariants.sql must remain the final migration whenever new server-side tables or RPCs are added. migration-security-invariants.test.ts enforces this in CI.

Earlier migrations preserve historical bootstrap steps, including temporary internal-MVP grants. Do not infer the production security posture from an intermediate migration; the tail security-invariants migration defines the required final state.
