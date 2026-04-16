CREATE TYPE "access_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "access_level" AS ENUM('view', 'operate', 'manage');--> statement-breakpoint
CREATE TYPE "device_status" AS ENUM('pending', 'active', 'inactive', 'disabled');--> statement-breakpoint
CREATE TYPE "event_severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "external_message_status" AS ENUM('accepted', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "scope_kind" AS ENUM('platform', 'headquarter', 'factory', 'department', 'device');--> statement-breakpoint
CREATE TYPE "storage_object_status" AS ENUM('requested', 'uploaded', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_access_grant" (
	"id" text PRIMARY KEY,
	"subject_type" text DEFAULT 'user' NOT NULL,
	"subject_id" text NOT NULL,
	"app_id" text NOT NULL,
	"scope_kind" "scope_kind" NOT NULL,
	"scope_id" text NOT NULL,
	"access_level" "access_level" DEFAULT 'view'::"access_level" NOT NULL,
	"effect" "access_effect" DEFAULT 'allow'::"access_effect" NOT NULL,
	"conditions" jsonb DEFAULT '{}' NOT NULL,
	"granted_by_user_id" text,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_definition" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'operations' NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" text PRIMARY KEY,
	"factory_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" text PRIMARY KEY,
	"public_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"department_id" text,
	"status" "device_status" DEFAULT 'pending'::"device_status" NOT NULL,
	"last_seen_at" timestamp,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_token" (
	"id" text PRIMARY KEY,
	"device_id" text NOT NULL,
	"label" text DEFAULT 'Primary token' NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by_user_id" text,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_message" (
	"id" text PRIMARY KEY,
	"request_path" text NOT NULL,
	"message_type" text NOT NULL,
	"schema_version" text DEFAULT '1.0' NOT NULL,
	"source_type" text DEFAULT 'device' NOT NULL,
	"source_id" text,
	"correlation_id" text,
	"target" text NOT NULL,
	"status" "external_message_status" DEFAULT 'accepted'::"external_message_status" NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"attachments" jsonb DEFAULT '{}' NOT NULL,
	"processed_at" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory" (
	"id" text PRIMARY KEY,
	"headquarter_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"timezone" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "headquarter" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_object" (
	"id" text PRIMARY KEY,
	"object_key" text NOT NULL,
	"content_type" text,
	"purpose" text NOT NULL,
	"status" "storage_object_status" DEFAULT 'requested'::"storage_object_status" NOT NULL,
	"size_bytes" text,
	"checksum" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"uploaded_at" timestamp,
	"expires_at" timestamp,
	"created_by_device_id" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tilt_event" (
	"id" text PRIMARY KEY,
	"external_message_id" text,
	"device_id" text,
	"device_public_id" text,
	"title" text NOT NULL,
	"severity" "event_severity" DEFAULT 'medium'::"event_severity" NOT NULL,
	"summary" text,
	"angle" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"raw_payload" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_scope_membership" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"scope_kind" "scope_kind" NOT NULL,
	"scope_id" text NOT NULL,
	"role_key" text NOT NULL,
	"granted_by_user_id" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "violation_event" (
	"id" text PRIMARY KEY,
	"external_message_id" text,
	"device_id" text,
	"device_public_id" text,
	"title" text NOT NULL,
	"severity" "event_severity" DEFAULT 'medium'::"event_severity" NOT NULL,
	"summary" text,
	"image_object_id" text,
	"video_object_id" text,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"raw_payload" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" ("credential_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE INDEX "app_access_grant_subject_idx" ON "app_access_grant" ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "app_access_grant_scope_idx" ON "app_access_grant" ("scope_kind","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_definition_key_unique" ON "app_definition" ("key");--> statement-breakpoint
CREATE INDEX "department_factory_idx" ON "department" ("factory_id");--> statement-breakpoint
CREATE UNIQUE INDEX "department_factory_slug_unique" ON "department" ("factory_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "device_public_id_unique" ON "device" ("public_id");--> statement-breakpoint
CREATE INDEX "device_department_idx" ON "device" ("department_id");--> statement-breakpoint
CREATE INDEX "device_token_device_idx" ON "device_token" ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_token_hash_unique" ON "device_token" ("token_hash");--> statement-breakpoint
CREATE INDEX "external_message_target_idx" ON "external_message" ("target");--> statement-breakpoint
CREATE INDEX "external_message_source_idx" ON "external_message" ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "factory_headquarter_idx" ON "factory" ("headquarter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "factory_headquarter_slug_unique" ON "factory" ("headquarter_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "headquarter_slug_unique" ON "headquarter" ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "headquarter_code_unique" ON "headquarter" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_object_key_unique" ON "storage_object" ("object_key");--> statement-breakpoint
CREATE INDEX "tilt_event_device_idx" ON "tilt_event" ("device_id");--> statement-breakpoint
CREATE INDEX "user_scope_membership_user_idx" ON "user_scope_membership" ("user_id");--> statement-breakpoint
CREATE INDEX "user_scope_membership_scope_idx" ON "user_scope_membership" ("scope_kind","scope_id");--> statement-breakpoint
CREATE INDEX "violation_event_device_idx" ON "violation_event" ("device_id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_access_grant" ADD CONSTRAINT "app_access_grant_app_id_app_definition_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app_definition"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_access_grant" ADD CONSTRAINT "app_access_grant_granted_by_user_id_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "department" ADD CONSTRAINT "department_factory_id_factory_id_fkey" FOREIGN KEY ("factory_id") REFERENCES "factory"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_department_id_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "device_token" ADD CONSTRAINT "device_token_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "device_token" ADD CONSTRAINT "device_token_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "factory" ADD CONSTRAINT "factory_headquarter_id_headquarter_id_fkey" FOREIGN KEY ("headquarter_id") REFERENCES "headquarter"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "storage_object" ADD CONSTRAINT "storage_object_created_by_device_id_device_id_fkey" FOREIGN KEY ("created_by_device_id") REFERENCES "device"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "storage_object" ADD CONSTRAINT "storage_object_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tilt_event" ADD CONSTRAINT "tilt_event_external_message_id_external_message_id_fkey" FOREIGN KEY ("external_message_id") REFERENCES "external_message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "tilt_event" ADD CONSTRAINT "tilt_event_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "user_scope_membership" ADD CONSTRAINT "user_scope_membership_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_scope_membership" ADD CONSTRAINT "user_scope_membership_granted_by_user_id_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "violation_event" ADD CONSTRAINT "violation_event_external_message_id_external_message_id_fkey" FOREIGN KEY ("external_message_id") REFERENCES "external_message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "violation_event" ADD CONSTRAINT "violation_event_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "violation_event" ADD CONSTRAINT "violation_event_image_object_id_storage_object_id_fkey" FOREIGN KEY ("image_object_id") REFERENCES "storage_object"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "violation_event" ADD CONSTRAINT "violation_event_video_object_id_storage_object_id_fkey" FOREIGN KEY ("video_object_id") REFERENCES "storage_object"("id") ON DELETE SET NULL;