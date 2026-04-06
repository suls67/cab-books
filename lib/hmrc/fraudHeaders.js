function getRequestIp(req) {
  const forwardedFor = req.headers['x-forwarded-for']

  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0].trim()
  }

  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return forwardedFor[0].split(',')[0].trim()
  }

  return req.socket?.remoteAddress || ''
}

function getTimezoneOffsetString() {
  const offsetMinutes = -new Date().getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0')
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, '0')
  return `${sign}${hours}:${minutes}`
}

export function getHmrcFraudPreventionHeaders(req) {
  const browserUserAgent =
    req.headers['x-hmrc-browser-user-agent'] ||
    req.headers['user-agent'] ||
    'unknown-browser'
  const deviceId = req.headers['x-hmrc-device-id'] || 'unknown-device'
  const publicIp = getRequestIp(req) || '127.0.0.1'
  const timezone = req.headers['x-hmrc-timezone'] || getTimezoneOffsetString()
  const windowSize = req.headers['x-hmrc-window-size'] || 'width=0&height=0'
  const screens = req.headers['x-hmrc-screens'] || 'width=0&height=0&scaling-factor=1&colour-depth=24'
  const userId = req.headers['x-hmrc-user-id'] || 'unknown-user'
  const timestamp = new Date().toISOString()

  return {
    'Gov-Client-Connection-Method': 'WEB_APP_VIA_SERVER',
    'Gov-Client-Device-ID': String(deviceId),
    'Gov-Client-Browser-JS-User-Agent': String(browserUserAgent),
    'Gov-Client-Public-IP': String(publicIp),
    'Gov-Client-Public-IP-Timestamp': timestamp,
    'Gov-Client-Timezone': String(timezone),
    'Gov-Client-Window-Size': String(windowSize),
    'Gov-Client-Screens': String(screens),
    'Gov-Client-User-IDs': `appUser=${encodeURIComponent(String(userId))}`,
    'Gov-Vendor-Version': 'taximate=1.0.0'
  }
}
