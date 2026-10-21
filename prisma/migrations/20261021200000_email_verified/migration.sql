ALTER TABLE "Account" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "PasswordReset" DROP CONSTRAINT "PasswordReset_kind_check";
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_kind_check" CHECK ("kind" IN ('ACCOUNT', 'CUSTOMER', 'VERIFY_ACCOUNT', 'VERIFY_CUSTOMER'));
