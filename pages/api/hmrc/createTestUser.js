import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { getSupabaseAdmin } from '../../../lib/supabaseAdmin';
import { supabase } from '../../../supabaseClient';

const HMRC_BASE = 'https://test-api.service.hmrc.gov.uk';

async function getClientCredentialsToken() {
  const res = await fetch(`${HMRC_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.HMRC_CLIENT_ID,
      client_secret: process.env.HMRC_CLIENT_SECRET
    })
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data?.error_description || data?.message || 'Could not obtain client credentials token from HMRC.');
  }
  return data.access_token;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const appToken = getAccessTokenFromRequest(req);
    const currentDriver = await getDriverFromAccessToken(supabase, appToken);

    const { action, nino } = req.body || {};

    if (action === 'saveNino') {
      if (!nino) return res.status(400).json({ error: 'nino is required to save.' });

      const supabaseAdmin = getSupabaseAdmin();
      const { error: updateError } = await supabaseAdmin
        .from('drivers')
        .update({ nino })
        .eq('id', currentDriver.id);

      if (updateError) {
        return res.status(500).json({ error: `Could not save NINO: ${updateError.message}` });
      }

      return res.status(200).json({ saved: true, nino });
    }

    // Default action: create
    const clientToken = await getClientCredentialsToken();

    const createRes = await fetch(`${HMRC_BASE}/create-test-user/individuals`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${clientToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ serviceNames: ['mtd-income-tax'] })
    });

    const userData = await createRes.json();

    if (!createRes.ok) {
      return res.status(createRes.status).json({
        error: userData?.message || userData?.error || 'HMRC could not create test user.',
        details: userData
      });
    }

    return res.status(200).json({
      userId: userData.userId || null,
      password: userData.password || null,
      userFullName: userData.userFullName || null,
      nino: userData.nino || null,
      mtdItId: userData.mtdItId || null,
      saUtr: userData.saUtr || null,
      raw: userData
    });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Could not create HMRC test user.'
    });
  }
}
