module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (process.env.API_SECRET && authHeader !== `Bearer ${process.env.API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { url, path } = req.body;
  if (!url || !path) {
    return res.status(400).json({ error: 'url and path are required' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = 'agence-disko';
  const GITHUB_REPO = 'veille-dessange';

  try {
    const imgRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://www.tiktok.com/'
      }
    });
    if (!imgRes.ok) {
      return res.status(400).json({ error: `Image fetch failed: ${imgRes.status}` });
    }
    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    let sha;
    const checkRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
      { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'veille-proxy' } }
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      sha = existing.sha;
    }

    const body = { message: `Add thumbnail ${path}`, content: base64, branch: 'main' };
    if (sha) body.sha = sha;

    const pushRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'veille-proxy'
        },
        body: JSON.stringify(body)
      }
    );

    if (!pushRes.ok) {
      const errText = await pushRes.text();
      return res.status(500).json({ error: `GitHub push failed: ${pushRes.status}`, detail: errText });
    }

    return res.status(200).json({
      url: `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/${path}`,
      pushed: true
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
