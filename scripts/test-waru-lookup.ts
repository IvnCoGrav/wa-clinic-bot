import { resolveGoogleMapsUrl } from '../src/utils/google-maps-url-resolver';

async function main() {
  const url = 'https://maps.app.goo.gl/kRU1HSGoxEbWfGPM9?g_st=ac';
  console.log('Resolving URL:', url);
  const res = await resolveGoogleMapsUrl(url);
  console.log('Resolved:', JSON.stringify(res, null, 2));
}

main();
