import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { refreshToken } from '../../../lib/hmrc/refreshToken';
import { supabase } from '../../../supabaseClient';

const HMRC_BASE = 'https://test-api.service.hmrc.gov.uk';

function normaliseStatus(raw) {
  if (raw === 'F') return 'fulfilled';
  if (raw === 'O') return 'open';
  return raw?.toLowerCase() || 'unknown';
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const accessToken = getAccessTokenFromRequest(req);
    const currentDriver = await getDriverFromAccessToken(supabase, accessToken);

    const { data: driver, error: driverError } = await supabase
      .from('drivers')
      .select('nino')
      .eq('id', currentDriver.id)
      .maybeSingle();

    if (driverError || !driver) throw new Error('Driver not found');

    const { data: tokenData, error: tokenError } = await supabase
      .from('hmrc_tokens')
      .select('*')
      .eq('driver_id', currentDriver.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (tokenError || !tokenData) throw new Error('HMRC token not found');

    let hmrcToken = tokenData.access_token;
    if (!tokenData.expires_at || new Date(tokenData.expires_at) < new Date()) {
      hmrcToken = await refreshToken(tokenData, currentDriver.id, supabase);
    }

    // Step 1: get businessId
    const businessRes = await fetch(
      `${HMRC_BASE}/individuals/business/details/${driver.nino}/list`,
      {
        headers: {
          Authorization: `Bearer ${hmrcToken}`,
          Accept: 'application/vnd.hmrc.2.0+json',
          'Gov-Test-Scenario': 'DEFAULT'
        }
      }
    );

    const businessData = await businessRes.json();
    const businessId = businessData?.listOfBusinesses?.[0]?.businessId;
    if (!businessId) throw new Error('No business found for this driver');

    // Step 2: fetch quarterly + crystallisation obligations in parallel
    const [quarterlyRes, crystallisationRes] = await Promise.all([
      fetch(
        `${HMRC_BASE}/obligations/details/${driver.nino}/income-and-expenditure?typeOfBusiness=self-employment&businessId=${businessId}`,
        {
          headers: {
            Authorization: `Bearer ${hmrcToken}`,
            Accept: 'application/vnd.hmrc.3.0+json',
            'Gov-Test-Scenario': 'DEFAULT'
          }
        }
      ),
      fetch(
        `${HMRC_BASE}/obligations/details/${driver.nino}/crystallisation`,
        {
          headers: {
            Authorization: `Bearer ${hmrcToken}`,
            Accept: 'application/vnd.hmrc.1.0+json',
            'Gov-Test-Scenario': 'DEFAULT'
          }
        }
      )
    ]);

    const quarterlyData = await quarterlyRes.json();
    const crystallisationData = crystallisationRes.ok ? await crystallisationRes.json() : null;

    const obligation = quarterlyData?.obligations?.[0];
    if (!obligation) {
      return res.status(200).json({ businessId, periods: [], crystallisation: null });
    }

    const periods = (obligation.obligationDetails || []).map((item) => ({
      start: item.periodStartDate,
      end: item.periodEndDate,
      due: item.dueDate,
      status: normaliseStatus(item.status)
    }));

    const crystallisationObligation = crystallisationData?.obligations?.[0]?.obligationDetails?.[0];
    const crystallisation = crystallisationObligation
      ? {
          start: crystallisationObligation.inboundCorrespondenceFromDate || crystallisationObligation.periodStartDate || null,
          end: crystallisationObligation.inboundCorrespondenceToDate || crystallisationObligation.periodEndDate || null,
          due: crystallisationObligation.inboundCorrespondenceDueDate || crystallisationObligation.dueDate || null,
          status: normaliseStatus(crystallisationObligation.status),
          periodKey: crystallisationObligation.periodKey || null
        }
      : null;

    return res.status(200).json({
      businessId: obligation.businessId,
      periods,
      crystallisation
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
