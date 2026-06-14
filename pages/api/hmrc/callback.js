import { supabase } from '../../../supabaseClient';

export default async function handler(req, res) {
  const code = req.query.code;
  const driverId = Number(req.query.state);
  const clientId = process.env.HMRC_CLIENT_ID;
  const clientSecret = process.env.HMRC_CLIENT_SECRET;
  const redirectUri = process.env.HMRC_REDIRECT_URI;

  if (!driverId) {
    return res.redirect('/connect-hmrc?status=error&message=Missing%20driver%20state%20from%20HMRC%20callback');
  }

  const tokenResponse = await fetch('https://test-api.service.hmrc.gov.uk/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const data = await tokenResponse.json();
  console.log('HMRC response:', data);

  if (!data.access_token) {
    const message = encodeURIComponent(data?.error_description || data?.message || 'HMRC did not return an access token.');
    return res.redirect(`/connect-hmrc?status=error&message=${message}`);
  }

  // Save one active token row per driver
  const { error } = await supabase
    .from('hmrc_tokens')
    .upsert([{
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
      driver_id: driverId,
    }], {
      onConflict: 'driver_id'
    });

  if (error) {
    return res.redirect(`/connect-hmrc?status=error&message=${encodeURIComponent(error.message)}`);
  }

  return res.redirect('/connect-hmrc?status=success');
}
