import { getAccessTokenFromRequest, getDriverFromAccessToken } from '../../../lib/driverAuth';
import { supabase } from '../../../supabaseClient';

export default function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return (async () => {
    try {
      const accessToken = getAccessTokenFromRequest(req);
      const driver = await getDriverFromAccessToken(supabase, accessToken);
      const clientId = process.env.HMRC_CLIENT_ID;
      const redirectUri = process.env.HMRC_REDIRECT_URI;

      const authUrl = `https://test-api.service.hmrc.gov.uk/oauth/authorize?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=read:self-assessment write:self-assessment&state=${driver.id}`;

      if (req.method === 'POST') {
        return res.status(200).json({ authUrl });
      }

      res.redirect(authUrl);
    } catch (error) {
      res.status(401).json({
        error: error instanceof Error ? error.message : 'Unauthorized'
      });
    }
  })();
}

// https://test-api.service.hmrc.gov.uk/oauth/authorize?
// client_id=YOUR_CLIENT_ID
// &response_type=code
// &scope=read:self-assessment
// &redirect_uri=http://localhost:3000/api/hmrc/callback
// &state=xyz
