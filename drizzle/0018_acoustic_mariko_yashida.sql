ALTER TABLE "customers" ADD COLUMN "profile_completion_token_hash" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "profile_completion_bonus_claimed" boolean DEFAULT false NOT NULL;