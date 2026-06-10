// api/push-images-batch.js
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers['authorization'];
  if (process.env.API_SECRET && authHeader !== `Bearer ${process.env.API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { images } = req.body;
  if (!images || !Array.isArray(images)) {
    return res.status(400).json({ error: 'images array required: [{url, path}]' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const OWNER = 'agence-disko';
  const REPO = 'veille-dessange';

  async function getSha(path) {
    const r = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
      { headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'User-Agent': 'veille-proxy', 'Cache-Control': 'no-cache' } }
    );
    if (r.ok) { const d = await r.json(); return d.sha; }
    return undefined;
  }

  async function pushOne({ url, path }) {
    const githubUrl = `https://${OWNER}.github.io/${REPO}/${path}`;

    // Skip if already exists — idempotent
    const existingSha = await getSha(path);
    if (existingSha) {
      return { path, url: githubUrl, pushed: false, skipped: true };
    }

    // Download from TikTok CDN
    const imgRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/'
      }
    });
    if (!imgRes.ok) {
      return { path, url: githubUrl, pushed: false, error: `Download failed: ${imgRes.status}` };
    }

    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');

    // Push to GitHub (no SHA = create new file)
    const pushRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
          'User-Agent': 'veille-proxy'
        },
        body: JSON.stringify({ message: `Add thumbnail ${path}`, content: base64, branch: 'main' })
      }
    );

    if (pushRes.status === 409) {
      // Race: another call just created it — return URL anyway
      return { path, url: githubUrl, pushed: false, skipped: true, reason: 'concurrent' };
    }
    if (!pushRes.ok) {
      const errText = await pushRes.text();
      return { path, url: githubUrl, pushed: false, error: `GitHub ${pushRes.status}: ${errText.substring(0, 200)}` };
    }
    return { path, url: githubUrl, pushed: true };
  }

  // Sequential loop — zéro race condition
  const results = [];
  for (const img of images) {
    const result = await pushOne(img);
    results.push(result);
  }

  const pushed = results.filter(r => r.pushed).length;
  const skipped = results.filter(r => r.skipped).length;
  const errors = results.filter(r => r.error).length;

  return res.status(200).json({ results, summary: { total: images.length, pushed, skipped, errors } });
};
