-- The simulated order lifecycle (2026-09-05).
--
-- Additive and nullable. No backfill, deliberately: an existing row keeps
-- NULL and is therefore inert, which is how "orders that already exist
-- never progress" is enforced -- by the absence of data rather than by a
-- condition somebody has to remember to write.
--
-- CAMELCASE, because the `orders` table is camelCase. The newer assistant
-- tables use snake_case through @@map; this one does not, and a migration
-- has to match the table it alters rather than the house style of the
-- table next to it.
ALTER TABLE "orders" ADD COLUMN "simulationStartedAt" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "simulationPausedAt" TIMESTAMP(3);
