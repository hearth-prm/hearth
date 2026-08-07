-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FieldEntity" AS ENUM ('PERSON', 'EVENT');

-- CreateEnum
CREATE TYPE "FieldType" AS ENUM ('TEXT', 'LONGTEXT', 'NUMBER', 'DATE', 'DATETIME', 'BOOLEAN', 'SELECT', 'MULTISELECT', 'EMAIL', 'PHONE', 'URL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('EMAIL', 'PHONE', 'URL', 'ADDRESS', 'SOCIAL');

-- CreateEnum
CREATE TYPE "AttendeeRole" AS ENUM ('HOST', 'REQUIRED', 'OPTIONAL');

-- CreateEnum
CREATE TYPE "RsvpStatus" AS ENUM ('NEEDS_ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE');

-- CreateEnum
CREATE TYPE "SyncTarget" AS ENUM ('GOOGLE_CONTACT', 'GOOGLE_EVENT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "syncContactsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "syncCalendarEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultAddToGoogle" BOOLEAN NOT NULL DEFAULT true,
    "googleCalendarId" TEXT NOT NULL DEFAULT 'primary',
    "inviteAttendees" BOOLEAN NOT NULL DEFAULT true,
    "importRsvps" BOOLEAN NOT NULL DEFAULT true,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldDefinition" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "entity" "FieldEntity" NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "helpText" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "showInList" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "givenName" TEXT,
    "familyName" TEXT,
    "nickname" TEXT,
    "organization" TEXT,
    "jobTitle" TEXT,
    "birthday" DATE,
    "notes" TEXT,
    "displayName" TEXT NOT NULL DEFAULT '',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "addToGoogle" BOOLEAN NOT NULL DEFAULT true,
    "googleResourceName" TEXT,
    "googleEtag" TEXT,
    "googleSyncedAt" TIMESTAMP(3),
    "googleSyncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "googleSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactPoint" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "label" TEXT,
    "value" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipType" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "inverseLabel" TEXT NOT NULL,
    "symmetric" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelationshipType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fromPersonId" TEXT NOT NULL,
    "toPersonId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "notes" TEXT,
    "startedOn" DATE,
    "endedOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "custom" JSONB NOT NULL DEFAULT '{}',
    "addToGoogle" BOOLEAN NOT NULL DEFAULT true,
    "googleEventId" TEXT,
    "googleCalendarId" TEXT,
    "googleEtag" TEXT,
    "googleSyncToken" TEXT,
    "googleSyncedAt" TIMESTAMP(3),
    "googleSyncStatus" "SyncStatus" NOT NULL DEFAULT 'PENDING',
    "googleSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventAttendee" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "AttendeeRole" NOT NULL DEFAULT 'OPTIONAL',
    "rsvp" "RsvpStatus" NOT NULL DEFAULT 'NEEDS_ACTION',
    "notes" TEXT,
    "inviteToGoogle" BOOLEAN NOT NULL DEFAULT true,
    "googleInviteEmail" TEXT,
    "rsvpFromGoogleAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncTombstone" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "target" "SyncTarget" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "calendarId" TEXT,
    "etag" TEXT,
    "reason" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "FieldDefinition_ownerId_entity_archived_idx" ON "FieldDefinition"("ownerId", "entity", "archived");

-- CreateIndex
CREATE UNIQUE INDEX "FieldDefinition_ownerId_entity_key_key" ON "FieldDefinition"("ownerId", "entity", "key");

-- CreateIndex
CREATE INDEX "Person_ownerId_displayName_idx" ON "Person"("ownerId", "displayName");

-- CreateIndex
CREATE INDEX "Person_ownerId_updatedAt_idx" ON "Person"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Person_custom_idx" ON "Person" USING GIN ("custom" jsonb_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Person_ownerId_googleResourceName_key" ON "Person"("ownerId", "googleResourceName");

-- CreateIndex
CREATE INDEX "ContactPoint_personId_kind_order_idx" ON "ContactPoint"("personId", "kind", "order");

-- CreateIndex
CREATE INDEX "ContactPoint_value_idx" ON "ContactPoint"("value");

-- CreateIndex
CREATE INDEX "RelationshipType_ownerId_idx" ON "RelationshipType"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipType_ownerId_key_key" ON "RelationshipType"("ownerId", "key");

-- CreateIndex
CREATE INDEX "Relationship_ownerId_idx" ON "Relationship"("ownerId");

-- CreateIndex
CREATE INDEX "Relationship_toPersonId_idx" ON "Relationship"("toPersonId");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_fromPersonId_toPersonId_typeId_key" ON "Relationship"("fromPersonId", "toPersonId", "typeId");

-- CreateIndex
CREATE INDEX "Event_ownerId_startAt_idx" ON "Event"("ownerId", "startAt");

-- CreateIndex
CREATE INDEX "Event_custom_idx" ON "Event" USING GIN ("custom" jsonb_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Event_ownerId_googleCalendarId_googleEventId_key" ON "Event"("ownerId", "googleCalendarId", "googleEventId");

-- CreateIndex
CREATE INDEX "EventAttendee_personId_idx" ON "EventAttendee"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "EventAttendee_eventId_personId_key" ON "EventAttendee"("eventId", "personId");

-- CreateIndex
CREATE INDEX "SyncTombstone_ownerId_processedAt_idx" ON "SyncTombstone"("ownerId", "processedAt");

-- CreateIndex
CREATE INDEX "SyncTombstone_target_resourceId_idx" ON "SyncTombstone"("target", "resourceId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldDefinition" ADD CONSTRAINT "FieldDefinition_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactPoint" ADD CONSTRAINT "ContactPoint_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipType" ADD CONSTRAINT "RelationshipType_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_fromPersonId_fkey" FOREIGN KEY ("fromPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_toPersonId_fkey" FOREIGN KEY ("toPersonId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "RelationshipType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncTombstone" ADD CONSTRAINT "SyncTombstone_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

