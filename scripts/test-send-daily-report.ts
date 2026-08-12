import { dailyReportService } from '../src/services/daily-report.service';

async function run() {
  console.log('🚀 Triggering Daily Report for tenant default-tenant to WhatsApp Group Kala Rekap...');
  await dailyReportService.sendDailyReport('default-tenant');
  console.log('✅ Daily report sent successfully!');
}

run().catch(console.error);
