process.env.NODE_ENV = 'test';
const { treatmentCatalogService } = require('C:/Users/Ivan/.gemini/antigravity/scratch/wa-clinic-bot/src/services/treatment-catalog.service');
for (const q of ['pijat bayi ceria itu apa', 'moksa buat apa', 'nebulizer', 'pijat hamil', 'cukur rambut bayi', 'oksitosin massage']) {
  console.log('=== Q:', q);
  const res = treatmentCatalogService.searchCatalog(q);
  console.log(res ? res.split('\n').filter((l,i) => i%6===0).join(' | ') : '(kosong)');
}
