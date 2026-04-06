import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { supabase } from '../../../supabaseClient';
import { refreshToken } from '../../../lib/hmrc/refreshToken';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const accessToken = getAccessTokenFromRequest(req);
    const currentDriver = await getDriverFromAccessToken(supabase, accessToken);

    // Get driver
    const { data: driver, error: driverError } = await supabase
    .from('drivers')
    .select('nino')
    .eq('id', currentDriver.id)
    .maybeSingle();

    if (driverError || !driver) throw new Error('Driver not found');

    // Get token
    const { data: tokenData, error: tokenError } = await supabase
    .from('hmrc_tokens')
    .select('*')
    .eq('driver_id', currentDriver.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

    if (tokenError || !tokenData) throw new Error('HMRC token not found');

    let access_token = tokenData.access_token;
    console.log('expires_at:', tokenData.expires_at);
    console.log('now:', new Date());
    if (new Date(tokenData.expires_at) < new Date()) {
      access_token = await refreshToken(tokenData, currentDriver.id, supabase);
    }



    // // Call HMRC
    const response = await fetch(
      `https://test-api.service.hmrc.gov.uk/individuals/business/details/${driver.nino}/list`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/vnd.hmrc.2.0+json',
          'Gov-Test-Scenario': 'DEFAULT'
        }
      }
    );



    const result = await response.json();
    res.status(200).json(result);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
