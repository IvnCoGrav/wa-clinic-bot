-- G8: heartbeat cron lintas proses. Ditulis worker, dibaca /ready di proses app.
CREATE TABLE IF NOT EXISTS "cron_job_heartbeats" (
  "job_name" TEXT NOT NULL,
  "instance_id" TEXT NOT NULL,
  "last_started_at" TIMESTAMP(3),
  "last_finished_at" TIMESTAMP(3),
  "last_status" TEXT,
  "last_error" TEXT,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cron_job_heartbeats_pkey" PRIMARY KEY ("job_name")
);
