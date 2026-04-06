import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { supabase } from '../../../supabaseClient';
import { refreshToken } from '../../../lib/hmrc/refreshToken';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const accessToken = getAccessTokenFromRequest(req);
    const currentDriver = await getDriverFromAccessToken(supabase, accessToken);

    // Get driver
    const { data: driver, error: driverError } = await supabase
      .from('drivers')
      .select('nino')
      .eq('id', currentDriver.id)
      .maybeSingle();

    if (driverError || !driver) {
      throw new Error('Driver not found');
    }

    // Get token
    const { data: tokenData, error: tokenError } = await supabase
      .from('hmrc_tokens')
      .select('*')
      .eq('driver_id', currentDriver.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenError || !tokenData) {
      throw new Error('HMRC token not found');
    }

    let access_token = tokenData.access_token;

    // Refresh if expired
    if (!tokenData.expires_at || new Date(tokenData.expires_at) < new Date()) {
      access_token = await refreshToken(tokenData, currentDriver.id, supabase);
    }

    // Get businessId dynamically
    const businessResponse = await fetch(
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

    const businessData = await businessResponse.json();

    const businessId = businessData.listOfBusinesses[0].businessId;

    // Call HMRC obligations API
    const response = await fetch(
      `https://test-api.service.hmrc.gov.uk/obligations/details/${driver.nino}/income-and-expenditure?typeOfBusiness=self-employment&businessId=${businessId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${access_token}`,
          Accept: 'application/vnd.hmrc.3.0+json',
          'Gov-Test-Scenario': 'DEFAULT'
        }
      }
    );

    const result = await response.json();

    const obligation = result.obligations[0];

    const formatted = obligation.obligationDetails.map((item) => ({
      start: item.periodStartDate,
      end: item.periodEndDate,
      due: item.dueDate,
      status: item.status
    }));

    res.status(200).json({
      businessId: obligation.businessId,
      periods: formatted
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
