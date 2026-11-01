-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "emision" JSONB;

-- CreateIndex
CREATE INDEX "Invoice_resultado_idx" ON "Invoice"("resultado");
