import { prisma } from '../src/db/client';

async function runE2ETest() {
  console.log('=== END-TO-END CTA ATTRIBUTION TEST ===');
  
  // 1. Generate 1 link /cta asli & fetch redirect output
  console.log('\nStep 1: Generating /cta link...');
  const ctaUrl = 'http://localhost:3000/cta?utm_source=facebook_ad_e2e&divisi=test_unit';
  const ctaRes = await fetch(ctaUrl);
  const html = await ctaRes.text();
  
  // 2. Extract trackingCode & WA prefill text
  console.log('\nStep 2: Extracting trackingCode from /cta redirect HTML...');
  const decodedHtml = decodeURIComponent(html);
  const match = decodedHtml.match(/Promo\[(\w+)\]/);
  if (!match) {
    throw new Error('FAILED: Could not find Promo[code] in /cta HTML response!\nHTML:\n' + html);
  }
  const trackingCode = match[1];
  console.log(`-> Extracted trackingCode: "${trackingCode}"`);
  
  // Verify AdClick entry was created in DB
  const initialAdClick = await prisma.adClick.findFirst({
    where: { trackingCode },
  });
  console.log(`-> AdClick record in DB before message:`, {
    id: initialAdClick?.id,
    trackingCode: initialAdClick?.trackingCode,
    matchedAt: initialAdClick?.matchedAt,
    customerId: initialAdClick?.customerId,
  });

  // 3. Simulasikan pesan WA masuk dari Customer baru membawa teks Promo[code] ke webhook
  console.log('\nStep 3: Simulating inbound WA message with prefill text to /webhook...');
  const testPhone = `628999${Math.floor(100000 + Math.random() * 900000)}`;
  const waPayload = {
    event: 'message',
    session: 'default',
    payload: {
      id: `wamid.e2e_${Date.now()}`,
      from: `${testPhone}@c.us`,
      to: '6287751148065@c.us',
      body: `Promo[${trackingCode}] Halo CS, saya tertarik konsultasi`,
      hasMedia: false,
      timestamp: Math.floor(Date.now() / 1000),
    },
  };

  const webhookRes = await fetch('http://localhost:3000/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(waPayload),
  });

  console.log(`-> Webhook HTTP Status: ${webhookRes.status}`);

  // 4. Query DB AdClick untuk memverifikasi matchedAt & customerId
  console.log('\nStep 4: Verifying AdClick attribution in database...');
  // Sleep 1 second for async handling if any
  await new Promise((r) => setTimeout(r, 1000));

  const updatedAdClick = await prisma.adClick.findFirst({
    where: { trackingCode },
  });

  console.log('-> AdClick record in DB AFTER message:', {
    id: updatedAdClick?.id,
    trackingCode: updatedAdClick?.trackingCode,
    matchedAt: updatedAdClick?.matchedAt,
    customerId: updatedAdClick?.customerId,
  });

  if (updatedAdClick && updatedAdClick.matchedAt && updatedAdClick.customerId) {
    console.log('\n SUCCESS: END-TO-END TEST PASSED! Tracking code matched & linked to Customer ID successfully.');
  } else {
    console.error('\n FAILED: matchedAt or customerId is null!');
    process.exit(1);
  }
}

runE2ETest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
  });
