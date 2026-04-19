CREATE TABLE "department" (
	"id" text PRIMARY KEY,
	"factory_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_component_catalog" (
	"key" text PRIMARY KEY,
	"service_name" text NOT NULL,
	"display_name" text NOT NULL,
	"navigation_label" text NOT NULL,
	"route_path" text,
	"renderer_key" text,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"default_enabled" boolean DEFAULT true NOT NULL,
	"read_actions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"write_actions" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_component_installation" (
	"id" text PRIMARY KEY,
	"device_id" text NOT NULL,
	"component_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device" DROP CONSTRAINT "device_device_id_unique";--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "department_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "device" DROP COLUMN "device_id";--> statement-breakpoint
CREATE UNIQUE INDEX "device_component_installation_device_component_unique" ON "device_component_installation" ("device_id","component_key");--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" ("credential_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_factory_id_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_department_id_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "device_component_installation" ADD CONSTRAINT "device_component_installation_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device_component_installation" ADD CONSTRAINT "device_component_installation_Y8S3PpL09SfI_fkey" FOREIGN KEY ("component_key") REFERENCES "device_component_catalog"("key") ON DELETE CASCADE;