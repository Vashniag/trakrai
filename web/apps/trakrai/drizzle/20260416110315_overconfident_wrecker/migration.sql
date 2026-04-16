CREATE TABLE "device" (
	"id" text PRIMARY KEY,
	"device_id" text NOT NULL CONSTRAINT "device_device_id_unique" UNIQUE,
	"name" text NOT NULL,
	"description" text,
	"access_token" text NOT NULL CONSTRAINT "device_access_token_unique" UNIQUE,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
