import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { refreshToken } from '../../../lib/hmrc/refreshToken';
import { supabase } from '../../../supabaseClient';

const VALID_BUSINESS_TYPES = [
  'self-employment',
  'uk-property',
  'foreign-property',
  'uk-property-fhl',
  'foreign-property-fhl-eea'
];

const TAX_YEAR_PATTERN = /^\d{4}-\d{2}$/;

async function parseJsonSafely(response) {
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const appAccessToken = getAccessTokenFromRequest(req);
    const currentDriver = await getDriverFromAccessToken(supabase, appAccessToken);

    const { data: driver, error: driverError } = await supabase
      .from('drivers')
      .select('id, nino')
      .eq('id', currentDriver.id)
      .maybeSingle();

    if (driverError || !driver) {
      throw new Error('Driver not found');
    }

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

    let hmrcAccessToken = tokenData.access_token;

    if (!tokenData.expires_at || new Date(tokenData.expires_at) < new Date()) {
      hmrcAccessToken = await refreshToken(tokenData, currentDriver.id, supabase);
    }

    const { taxYear, typeOfBusiness = 'self-employment' } = req.query;

    if (!taxYear || !TAX_YEAR_PATTERN.test(taxYear)) {
      return res.status(400).json({ error: 'taxYear is required in YYYY-YY format, for example 2025-26.' });
    }

    if (!VALID_BUSINESS_TYPES.includes(typeOfBusiness)) {
      return res.status(400).json({
        error: `typeOfBusiness must be one of: ${VALID_BUSINESS_TYPES.join(', ')}`
      });
    }

    const businessResponse = await fetch(
      `https://test-api.service.hmrc.gov.uk/individuals/business/details/${driver.nino}/list`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${hmrcAccessToken}`,
          Accept: 'application/vnd.hmrc.2.0+json',
          'Gov-Test-Scenario': 'DEFAULT'
        }
      }
    );

    const businessData = await parseJsonSafely(businessResponse);
    const businessId = businessData?.listOfBusinesses?.[0]?.businessId;

    if (!businessResponse.ok || !businessId) {
      return res.status(businessResponse.status || 400).json({
        error: businessData?.message || businessData?.error || 'Could not load business details.',
        details: businessData
      });
    }

    const bissResponse = await fetch(
      `https://test-api.service.hmrc.gov.uk/individuals/self-assessment/income-summary/${driver.nino}/${typeOfBusiness}/${taxYear}/${businessId}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${hmrcAccessToken}`,
          Accept: 'application/vnd.hmrc.3.0+json',
          'Gov-Test-Scenario': 'DEFAULT'
        }
      }
    );

    const bissData = await parseJsonSafely(bissResponse);

    if (!bissResponse.ok) {
      return res.status(bissResponse.status).json({
        error: bissData?.message || bissData?.error || 'Could not retrieve income summary from HMRC.',
        details: bissData
      });
    }

    return res.status(200).json({
      success: true,
      taxYear,
      typeOfBusiness,
      businessId,
      summary: bissData
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Could not retrieve HMRC income summary.'
    });
  }
}
