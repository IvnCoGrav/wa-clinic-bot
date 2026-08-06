-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "cs_name" TEXT DEFAULT 'Cs Yusi',
ADD COLUMN     "format_checkout" TEXT DEFAULT 'list untuk reservasi :',
ADD COLUMN     "format_purchase" TEXT DEFAULT 'Payment',
ADD COLUMN     "format_value" TEXT DEFAULT 'Treatment = %VALUE%',
ADD COLUMN     "format_visit" TEXT DEFAULT 'Promo[%ID%]';
