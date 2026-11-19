-- Live tracking tables (additive only). Applied automatically by `npx prisma db push`;
-- run this by hand only if your Render build does not push the schema.
-- CreateTable
CREATE TABLE "TripTracking" (
    "tripId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripTracking_pkey" PRIMARY KEY ("tripId")
);

-- CreateTable
CREATE TABLE "TripLocationPoint" (
    "id" SERIAL NOT NULL,
    "tripId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripLocationPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripLocationPoint_tripId_recordedAt_idx" ON "TripLocationPoint"("tripId", "recordedAt");

-- AddForeignKey
ALTER TABLE "TripTracking" ADD CONSTRAINT "TripTracking_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripLocationPoint" ADD CONSTRAINT "TripLocationPoint_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

