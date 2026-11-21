-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "code" INTEGER,
    "message" TEXT,
    "mode" TEXT,
    "gatewayTxnId" TEXT,
    "receiptId" TEXT,
    "excess" INTEGER NOT NULL DEFAULT 0,
    "initiatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_orderId_key" ON "PaymentAttempt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_receiptId_key" ON "PaymentAttempt"("receiptId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_tenantId_createdAt_idx" ON "PaymentAttempt"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_studentId_idx" ON "PaymentAttempt"("studentId");

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

