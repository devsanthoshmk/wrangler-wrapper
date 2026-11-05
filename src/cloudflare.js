/**
 * Cloudflare API helper to query user details and account listings
 */
async function fetchCloudflareUser(token) {
  if (!token) return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'wrangler-wrapper/1.0.0'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    const data = await res.json();
    return data?.result || null;
  } catch (err) {
    clearTimeout(timeoutId);
    return null;
  }
}

async function fetchCloudflareAccounts(token) {
  if (!token) return [];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'wrangler-wrapper/1.0.0'
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!res.ok) return [];
    const data = await res.json();
    return data?.result || [];
  } catch (err) {
    clearTimeout(timeoutId);
    return [];
  }
}

module.exports = {
  fetchCloudflareUser,
  fetchCloudflareAccounts
};
