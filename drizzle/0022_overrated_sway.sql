CREATE TABLE "ttl_agent"."users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"username" text NOT NULL,
	"github_id" text NOT NULL
);
