export function getAccessTokenFromRequest(req) {
  const authHeader = req.headers.authorization || ''

  if (!authHeader.startsWith('Bearer ')) {
    return null
  }

  return authHeader.slice(7)
}

export async function getDriverByEmail(supabaseClient, email) {
  if (!email) {
    throw new Error('No email was available for the signed-in user')
  }

  const { data: driver, error } = await supabaseClient
    .from('drivers')
    .select('id, name, email, nino')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    throw new Error(`Could not load driver profile: ${error.message}`)
  }

  if (!driver) {
    throw new Error('No driver profile is linked to this account')
  }

  return driver
}

export async function getDriverByAuthUserId(supabaseClient, authUserId) {
  if (!authUserId) {
    return null
  }

  const { data: driver, error } = await supabaseClient
    .from('drivers')
    .select('id, name, email, nino, auth_user_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (error) {
    throw new Error(`Could not load driver profile: ${error.message}`)
  }

  return driver
}

export async function getDriverForUser(supabaseClient, user) {
  if (!user) {
    throw new Error('No signed-in user was found')
  }

  const driverByAuthId = await getDriverByAuthUserId(supabaseClient, user.id)
  if (driverByAuthId) {
    return driverByAuthId
  }

  return getDriverByEmail(supabaseClient, user.email)
}

export async function getCurrentDriver(supabaseClient) {
  const { data, error } = await supabaseClient.auth.getUser()

  if (error) {
    throw new Error(`Could not load the signed-in user: ${error.message}`)
  }

  return getDriverForUser(supabaseClient, data.user)
}

export async function getDriverFromAccessToken(supabaseClient, accessToken) {
  if (!accessToken) {
    throw new Error('Unauthorized')
  }

  const { data, error } = await supabaseClient.auth.getUser(accessToken)

  if (error) {
    throw new Error(`Could not validate the signed-in user: ${error.message}`)
  }

  if (!data.user) {
    throw new Error('Unauthorized')
  }

  return getDriverForUser(supabaseClient, data.user)
}
