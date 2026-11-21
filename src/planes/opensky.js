// OpenSky Network's live plane positions. A free account gets 4,000 credits a day and
// one worldwide snapshot costs 4. Without an account it's 400 a day, shared by everyone on the same IP.
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const STATES_URL = 'https://opensky-network.org/api/states/all?extended=1';

export async function getToken({ clientId, clientSecret, timeoutMs = 20000 }) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`OpenSky login answered ${response.status}`);
  return (await response.json()).access_token;
}

// Returns OpenSky's { time, states } answer. Pass no credentials to ask anonymously.
// With an account, `time` (in seconds) can go up to an hour back.
export async function downloadStates({ clientId, clientSecret, time, timeoutMs = 20000 } = {}) {
  const headers = {};
  if (clientId && clientSecret) headers.Authorization = `Bearer ${await getToken({ clientId, clientSecret })}`;
  const url = time ? `${STATES_URL}&time=${time}` : STATES_URL;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const wait = response.headers.get('x-rate-limit-retry-after-seconds');
    throw new Error(`OpenSky answered ${response.status}${wait ? `, out of credits for ${wait} s` : ''}`);
  }
  const data = await response.json();
  if (!Array.isArray(data.states)) throw new Error('OpenSky sent no planes');
  return { ...data, remaining: Number(response.headers.get('x-rate-limit-remaining')) };
}
