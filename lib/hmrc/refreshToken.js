export async function refreshToken(tokenData, DRIVER_ID, supabase) {
  const response = await fetch('https://test-api.service.hmrc.gov.uk/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenData.refresh_token,
      client_id: process.env.HMRC_CLIENT_ID,
      client_secret: process.env.HMRC_CLIENT_SECRET
    })
  });

  const refreshData = await response.json();

  if (!response.ok) {
    const reason =
      refreshData.error_description ||
      refreshData.message ||
      refreshData.error ||
      'Unknown HMRC refresh error';

    throw new Error(`Failed to refresh token: ${reason}`);
  }

  const { error } = await supabase
    .from('hmrc_tokens')
    .upsert([{
      access_token: refreshData.access_token,
      refresh_token: refreshData.refresh_token || tokenData.refresh_token,
      expires_at: new Date(Date.now() + refreshData.expires_in * 1000),
      driver_id: DRIVER_ID
    }], {
      onConflict: 'driver_id'
    });

  if (error) {
    throw new Error(`Failed to save refreshed HMRC token: ${error.message}`);
  }

  return refreshData.access_token;
}
