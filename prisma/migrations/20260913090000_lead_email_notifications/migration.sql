-- CreateEnum
CREATE TYPE "NotifyStatus" AS ENUM ('NOT_ATTEMPTED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "notifyAt" TIMESTAMP(3),
ADD COLUMN     "notifyError" TEXT,
ADD COLUMN     "notifyRecipients" TEXT,
ADD COLUMN     "notifyStatus" "NotifyStatus" NOT NULL DEFAULT 'NOT_ATTEMPTED';

