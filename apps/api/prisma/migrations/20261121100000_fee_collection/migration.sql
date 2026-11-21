-- AlterTable
ALTER TABLE "FeeInvoice" ADD COLUMN     "fineFrom" DATE,
ADD COLUMN     "finePaid" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fineWaived" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "receiptPrefix" TEXT NOT NULL DEFAULT 'RCPT';

-- CreateTable
CREATE TABLE "FeeReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "no" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mode" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'Counter',
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "feeTotal" INTEGER NOT NULL,
    "fineTotal" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "bank" TEXT,
    "instrumentNo" TEXT,
    "instrumentDate" DATE,
    "reference" TEXT,
    "remarks" TEXT,
    "recon" TEXT NOT NULL DEFAULT 'NA',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,

    CONSTRAINT "FeeReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeReceiptLine" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,
    "fine" INTEGER NOT NULL DEFAULT 0,
    "fineWaived" INTEGER NOT NULL DEFAULT 0,
    "prevFineFrom" DATE,

    CONSTRAINT "FeeReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptSequence" (
    "tenantId" TEXT NOT NULL,
    "yearLabel" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReceiptSequence_pkey" PRIMARY KEY ("tenantId","yearLabel")
);

-- CreateIndex
CREATE INDEX "FeeReceipt_branchId_date_idx" ON "FeeReceipt"("branchId", "date");

-- CreateIndex
CREATE INDEX "FeeReceipt_studentId_idx" ON "FeeReceipt"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeReceipt_tenantId_no_key" ON "FeeReceipt"("tenantId", "no");

-- CreateIndex
CREATE INDEX "FeeReceiptLine_invoiceId_idx" ON "FeeReceiptLine"("invoiceId");

-- AddForeignKey
ALTER TABLE "FeeReceipt" ADD CONSTRAINT "FeeReceipt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReceipt" ADD CONSTRAINT "FeeReceipt_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReceipt" ADD CONSTRAINT "FeeReceipt_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReceiptLine" ADD CONSTRAINT "FeeReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "FeeReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeReceiptLine" ADD CONSTRAINT "FeeReceiptLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "FeeInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

