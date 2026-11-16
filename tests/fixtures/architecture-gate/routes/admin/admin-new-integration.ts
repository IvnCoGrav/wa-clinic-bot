import { wahaClient } from 'src/integrations/waha/client';
import { geocodeAddress } from 'src/integrations/google-maps/geocoding';

export const dummyAdminRoute = () => {
  return { wahaClient, geocodeAddress };
};
