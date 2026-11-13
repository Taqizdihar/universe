# Restore and reset plan

The schema-only DDL is available for manual execution after a passing preflight. No tenant DML is supplied. MySQL DDL is not transactionally rolled back as one unit. Before importing, the administrator must verify a current, restorable backup of the **separate rehearsal database** and record its name and schema version.

On a future partial schema or data failure, stop at the failed statement. Collect the error, table/row counts, index/FK/CHECK verification, and migration batch ID. Do not run another stage, disable foreign-key checks, or use `IF NOT EXISTS` to hide differences. Decide whether to reconcile against the recorded checkpoint or discard and reprovision the disposable rehearsal schema. A reset requires separate human review of the exact target name and a verified backup. Never run DROP/TRUNCATE against `uniin_universe` or `defaultdb`.

No destructive rollback SQL is supplied. The current development CMS, production Aiven database, and tenant-facing integrations are not rollback targets.
