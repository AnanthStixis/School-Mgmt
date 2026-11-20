-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "admissionType" TEXT NOT NULL DEFAULT 'Re-admission',
ADD COLUMN     "pickupMode" TEXT,
ADD COLUMN     "rte" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "staffKid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transportSlab" TEXT;

-- CreateTable
CREATE TABLE "FeeBand" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromGrade" INTEGER NOT NULL,
    "toGrade" INTEGER NOT NULL,

    CONSTRAINT "FeeBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeType" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "components" JSONB,
    "ratesConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeInstallmentPlan" (
    "id" TEXT NOT NULL,
    "feeTypeId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,

    CONSTRAINT "FeeInstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeRate" (
    "id" TEXT NOT NULL,
    "feeTypeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,

    CONSTRAINT "FeeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeAssignment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "feeTypeId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "gross" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "onlineEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "FeeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeInvoice" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "gross" INTEGER NOT NULL,
    "concession" INTEGER NOT NULL DEFAULT 0,
    "adjustment" INTEGER NOT NULL DEFAULT 0,
    "paid" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FeeInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeeBand_branchId_name_key" ON "FeeBand"("branchId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FeeType_branchId_academicYearId_name_key" ON "FeeType"("branchId", "academicYearId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FeeInstallmentPlan_feeTypeId_seq_key" ON "FeeInstallmentPlan"("feeTypeId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "FeeRate_feeTypeId_key_key" ON "FeeRate"("feeTypeId", "key");

-- CreateIndex
CREATE INDEX "FeeAssignment_feeTypeId_status_idx" ON "FeeAssignment"("feeTypeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FeeAssignment_studentId_feeTypeId_key" ON "FeeAssignment"("studentId", "feeTypeId");

-- CreateIndex
CREATE INDEX "FeeInvoice_studentId_idx" ON "FeeInvoice"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeInvoice_assignmentId_seq_key" ON "FeeInvoice"("assignmentId", "seq");

-- AddForeignKey
ALTER TABLE "FeeBand" ADD CONSTRAINT "FeeBand_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeType" ADD CONSTRAINT "FeeType_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeType" ADD CONSTRAINT "FeeType_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInstallmentPlan" ADD CONSTRAINT "FeeInstallmentPlan_feeTypeId_fkey" FOREIGN KEY ("feeTypeId") REFERENCES "FeeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeRate" ADD CONSTRAINT "FeeRate_feeTypeId_fkey" FOREIGN KEY ("feeTypeId") REFERENCES "FeeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAssignment" ADD CONSTRAINT "FeeAssignment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeAssignment" ADD CONSTRAINT "FeeAssignment_feeTypeId_fkey" FOREIGN KEY ("feeTypeId") REFERENCES "FeeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeInvoice" ADD CONSTRAINT "FeeInvoice_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "FeeAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

