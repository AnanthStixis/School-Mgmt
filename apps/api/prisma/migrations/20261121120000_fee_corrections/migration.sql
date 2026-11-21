-- AlterTable
ALTER TABLE "FeeInvoice" ADD COLUMN     "refunded" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FeeCorrection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,
    "remarks" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeRefund" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "mode" TEXT NOT NULL,
    "bank" TEXT,
    "instrumentNo" TEXT,
    "remarks" TEXT NOT NULL,
    "allocation" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Completed',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeCorrection_tenantId_kind_createdAt_idx" ON "FeeCorrection"("tenantId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "FeeCorrection_assignmentId_idx" ON "FeeCorrection"("assignmentId");

-- CreateIndex
CREATE INDEX "FeeRefund_tenantId_date_idx" ON "FeeRefund"("tenantId", "date");

-- CreateIndex
CREATE INDEX "FeeRefund_receiptId_idx" ON "FeeRefund"("receiptId");

-- AddForeignKey
ALTER TABLE "FeeCorrection" ADD CONSTRAINT "FeeCorrection_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeCorrection" ADD CONSTRAINT "FeeCorrection_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "FeeAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeRefund" ADD CONSTRAINT "FeeRefund_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeRefund" ADD CONSTRAINT "FeeRefund_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "FeeReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

